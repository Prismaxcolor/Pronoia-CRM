import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Idempotencia de las operaciones de dinero: POST /api/pagos, /api/pagos/multiple, /api/cobros/multiple,
 * notas de ajuste (proveedor y cliente) y facturas de compra/venta con el mismo clientRequestId ejecutan el
 * servicio UNA vez y la repetición responde 200 con `repetida`. El almacén de idempotencia es un doble en memoria;
 * aquí se prueba el cableado de las rutas y el aviso `operacion_sin_client_request_id`.
 */

const usuarios: Record<string, { rol: string; permisos: Array<{ recurso: string; accion: string }> | null; activo: boolean }> = {};

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: (tabla: string) => {
      let id: string | null = null;
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (_c: string, v: string) => { id = v; return b; },
        maybeSingle: async () => ({ data: tabla === 'users' && id ? usuarios[id] ?? null : null, error: null }),
      };
      return b;
    },
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock('../src/services/auth-service.js', () => ({
  verificarToken: (token: string) => {
    if (!usuarios[token]) throw new Error('token inválido');
    return { sub: token, email: `${token}@x.test`, rol: usuarios[token].rol };
  },
}));
vi.mock('../src/services/edicion-autorizada-service.js', () => ({
  esSuperadminEnBd: async (id: string) => usuarios[id]?.rol === 'superadmin' && usuarios[id]?.activo === true,
  obtenerUsuarioVigente: async (id: string) => (usuarios[id] ? { rol: usuarios[id].rol, activo: usuarios[id].activo } : null),
}));

const s = vi.hoisted(() => ({
  registrarPago: vi.fn(),
  registrarPagoMultiple: vi.fn(),
  registrarCobroMultiple: vi.fn(),
  crearNotaAjuste: vi.fn(),
  crearNotaAjusteCliente: vi.fn(),
  crearFactura: vi.fn(),
  avisos: [] as Array<Record<string, unknown>>,
}));
const guardadas = vi.hoisted(() => new Map<string, unknown>());

vi.mock('../src/services/idempotencia-service.js', () => ({
  ejecutarIdempotente: async (id: string, _tipo: string, _u: string, fn: () => Promise<unknown>) => {
    if (guardadas.has(id)) return { resultado: guardadas.get(id), repetida: true };
    const resultado = await fn();
    if (!(resultado && typeof resultado === 'object' && 'error' in resultado)) guardadas.set(id, resultado);
    return { resultado, repetida: false };
  },
  responderErrorIdempotencia: () => false,
}));
vi.mock('../src/services/banca-acceso-service.js', () => ({
  accesoBancas: async () => ({ ver: null, editar: null }),
  bancasPermitidas: async () => null,
  idsBancasDeGrupo: async () => [],
  idsBancasDeMovimiento: async () => [],
  concederBancaAUsuario: vi.fn(),
  listarBancasDeUsuario: vi.fn(),
  reemplazarBancasDeUsuario: vi.fn(),
}));
vi.mock('../src/services/pago-service.js', () => ({ registrarPago: s.registrarPago, registrarPagoMultiple: s.registrarPagoMultiple }));
vi.mock('../src/services/cobro-service.js', () => ({ registrarCobroMultiple: s.registrarCobroMultiple }));
vi.mock('../src/services/pagos-pasos-service.js', () => ({ reintentarPasosPendientes: vi.fn() }));
vi.mock('../src/services/nota-ajuste-service.js', () => ({
  crearNotaAjuste: s.crearNotaAjuste, anularNotaAjusteConLlave: vi.fn(), obtenerNotaAjuste: vi.fn(),
}));
vi.mock('../src/services/nota-ajuste-cliente-service.js', () => ({
  crearNotaAjusteCliente: s.crearNotaAjusteCliente, anularNotaAjusteClienteConLlave: vi.fn(), obtenerNotaAjusteCliente: vi.fn(),
}));
vi.mock('../src/services/factura-service.js', () => ({
  crearFactura: s.crearFactura, listarFacturas: vi.fn(), obtenerFactura: vi.fn(),
}));
vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: (p: Record<string, unknown>) => { s.avisos.push(p); }, error: vi.fn() },
  clienteIp: () => '127.0.0.1',
}));

const { default: pagosRouter } = await import('../src/routes/pagos.js');
const { default: cobrosRouter } = await import('../src/routes/cobros.js');
const { default: proveedoresRouter } = await import('../src/routes/proveedores.js');
const { default: clientesRouter } = await import('../src/routes/clientes.js');
const { default: facturasCompraRouter } = await import('../src/routes/facturas-compra.js');
const { default: facturasVentaRouter } = await import('../src/routes/facturas-venta.js');

const ID = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const REQ = ID(4);
const PROV = ID(1);
const BANCA = ID(2);
const FACT = ID(3);

let servidor: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/pagos', pagosRouter);
  app.use('/api/cobros', cobrosRouter);
  app.use('/api/proveedores', proveedoresRouter);
  app.use('/api/clientes', clientesRouter);
  app.use('/api/facturas-compra', facturasCompraRouter);
  app.use('/api/facturas-venta', facturasVentaRouter);
  await new Promise<void>(resolve => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => { servidor.close(); });

beforeEach(() => {
  guardadas.clear();
  s.avisos.length = 0;
  for (const m of [s.registrarPago, s.registrarPagoMultiple, s.registrarCobroMultiple, s.crearNotaAjuste, s.crearNotaAjusteCliente, s.crearFactura]) m.mockReset();
  usuarios.root = { rol: 'superadmin', permisos: null, activo: true };
});

async function post(ruta: string, body: unknown) {
  const res = await fetch(`${base}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer root' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

const pagoSimple = { proveedorId: PROV, bancaId: BANCA, monto: 100, moneda: 'USD', montoUsd: 100, fecha: '2026-10-16' };
const pagoMulti = {
  proveedorId: PROV, bancas: [{ bancaId: BANCA, monto: 100, moneda: 'USD', montoUsd: 100 }], montoUsd: 100,
  fecha: '2026-10-16', items: [{ tipo: 'factura', id: FACT, montoUsd: 100 }],
};
const cobroMulti = { ...pagoMulti, proveedorId: undefined, clienteId: PROV };
const nota = { tipo: 'credito', monto: 25, motivo: 'ajuste' };
const factura = { entidadId: PROV, items: [{ productoId: ID(5), peso: 10, precioUnitario: 1 }] };

describe('POST /api/pagos', () => {
  it('con el mismo clientRequestId registra una sola vez: la repetición responde 200 con repetida', async () => {
    s.registrarPago.mockResolvedValue({ movimientoId: 'm-1' });
    const a = await post('/api/pagos', { ...pagoSimple, clientRequestId: REQ });
    const b = await post('/api/pagos', { ...pagoSimple, clientRequestId: REQ });
    expect(a.status).toBe(201);
    expect(a.json).not.toHaveProperty('repetida');
    expect(b).toMatchObject({ status: 200, json: { movimientoId: 'm-1', repetida: true } });
    expect(s.registrarPago).toHaveBeenCalledTimes(1);
  });

  it('sin clientRequestId funciona como siempre pero deja el aviso operacion_sin_client_request_id', async () => {
    s.registrarPago.mockResolvedValue({ movimientoId: 'm-1' });
    expect((await post('/api/pagos', pagoSimple)).status).toBe(201);
    expect((await post('/api/pagos', pagoSimple)).status).toBe(201);
    expect(s.registrarPago).toHaveBeenCalledTimes(2);
    expect(s.avisos.filter(a => a.evento === 'operacion_sin_client_request_id')).toHaveLength(2);
  });

  it('con clave no deja el aviso de clave ausente', async () => {
    s.registrarPago.mockResolvedValue({ movimientoId: 'm-1' });
    await post('/api/pagos', { ...pagoSimple, clientRequestId: REQ });
    expect(s.avisos.filter(a => a.evento === 'operacion_sin_client_request_id')).toHaveLength(0);
  });

  it('un rechazo de negocio responde 400 y no se guarda: el reintento vuelve a ejecutar', async () => {
    s.registrarPago.mockResolvedValueOnce({ error: 'Saldo insuficiente' }).mockResolvedValueOnce({ movimientoId: 'm-2' });
    expect(await post('/api/pagos', { ...pagoSimple, clientRequestId: REQ })).toMatchObject({ status: 400, json: { error: 'Saldo insuficiente' } });
    expect(await post('/api/pagos', { ...pagoSimple, clientRequestId: REQ })).toMatchObject({ status: 201 });
  });

  it('rechaza un clientRequestId que no es UUID', async () => {
    expect((await post('/api/pagos', { ...pagoSimple, clientRequestId: 'abc' })).status).toBe(400);
    expect(s.registrarPago).not.toHaveBeenCalled();
  });
});

describe('POST /api/pagos/multiple', () => {
  it('deduplica por clientRequestId', async () => {
    s.registrarPagoMultiple.mockResolvedValue({ grupoId: 'g-1', numeroPago: 7, numeroAdelanto: null, numeroCruce: null });
    const a = await post('/api/pagos/multiple', { ...pagoMulti, clientRequestId: REQ });
    const b = await post('/api/pagos/multiple', { ...pagoMulti, clientRequestId: REQ });
    expect(a.status).toBe(201);
    expect(b).toMatchObject({ status: 200, json: { grupoId: 'g-1', repetida: true } });
    expect(s.registrarPagoMultiple).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/cobros/multiple', () => {
  it('deduplica por clientRequestId', async () => {
    s.registrarCobroMultiple.mockResolvedValue({ grupoId: 'g-2', numeroCobro: 3, numeroAnticipo: null, numeroCruce: null });
    const a = await post('/api/cobros/multiple', { ...cobroMulti, clientRequestId: REQ });
    const b = await post('/api/cobros/multiple', { ...cobroMulti, clientRequestId: REQ });
    expect(a.status).toBe(201);
    expect(b).toMatchObject({ status: 200, json: { grupoId: 'g-2', repetida: true } });
    expect(s.registrarCobroMultiple).toHaveBeenCalledTimes(1);
  });
});

describe('notas de ajuste', () => {
  it('de proveedor: una sola nota por clientRequestId', async () => {
    s.crearNotaAjuste.mockResolvedValue({ id: 'n-1', codigo: 'NC-1' });
    const ruta = `/api/proveedores/${PROV}/notas-ajuste`;
    const a = await post(ruta, { ...nota, clientRequestId: REQ });
    const b = await post(ruta, { ...nota, clientRequestId: REQ });
    expect(a.status).toBe(201);
    expect(b).toMatchObject({ status: 200, json: { id: 'n-1', repetida: true } });
    expect(s.crearNotaAjuste).toHaveBeenCalledTimes(1);
  });

  it('de cliente: una sola nota por clientRequestId', async () => {
    s.crearNotaAjusteCliente.mockResolvedValue({ id: 'n-2', codigo: 'ND-1' });
    const ruta = `/api/clientes/${PROV}/notas-ajuste`;
    const a = await post(ruta, { ...nota, clientRequestId: REQ });
    const b = await post(ruta, { ...nota, clientRequestId: REQ });
    expect(a.status).toBe(201);
    expect(b).toMatchObject({ status: 200, json: { id: 'n-2', repetida: true } });
    expect(s.crearNotaAjusteCliente).toHaveBeenCalledTimes(1);
  });

  it('el mismo clientRequestId sobre otro proveedor no reutiliza el resultado: el tipo ata el recurso', async () => {
    const tipos: string[] = [];
    const { ejecutarOperacionCon } = await import('../src/services/operaciones-idempotentes-cola.js');
    await ejecutarOperacionCon(
      async (_id, tipo, _u, fn) => { tipos.push(tipo); return { resultado: await fn(), repetida: false }; },
      `nota_ajuste_proveedor_crear:${PROV}`, { clientRequestId: REQ }, 'u', async () => 1,
    );
    expect(tipos).toEqual([`nota_ajuste_proveedor_crear:${PROV}`]);
  });

  it('un monto con más de 2 decimales o desorbitado da 400 sin llamar al servicio', async () => {
    const ruta = `/api/proveedores/${PROV}/notas-ajuste`;
    expect((await post(ruta, { ...nota, monto: 10.123 })).status).toBe(400);
    expect((await post(ruta, { ...nota, monto: 99_000_000_000 })).status).toBe(400);
    expect(s.crearNotaAjuste).not.toHaveBeenCalled();
  });
});

describe('facturas', () => {
  it('de compra: una sola factura por clientRequestId', async () => {
    s.crearFactura.mockResolvedValue({ factura: { id: 'f-1', ticketIds: [] } });
    const a = await post('/api/facturas-compra', { ...factura, clientRequestId: REQ });
    const b = await post('/api/facturas-compra', { ...factura, clientRequestId: REQ });
    expect(a.status).toBe(201);
    expect(b).toMatchObject({ status: 200, json: { repetida: true, factura: { id: 'f-1' } } });
    expect(s.crearFactura).toHaveBeenCalledTimes(1);
  });

  it('de venta: una sola factura por clientRequestId', async () => {
    s.crearFactura.mockResolvedValue({ factura: { id: 'f-2', ticketIds: [] } });
    const a = await post('/api/facturas-venta', { ...factura, clientRequestId: REQ });
    const b = await post('/api/facturas-venta', { ...factura, clientRequestId: REQ });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(s.crearFactura).toHaveBeenCalledTimes(1);
  });
});
