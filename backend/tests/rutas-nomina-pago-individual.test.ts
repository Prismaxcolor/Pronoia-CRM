import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Cableado de los pagos de la fase 4: pagar a UN trabajador, pagar (desembolsar) un préstamo, crear un préstamo con su pago y
 * anular un préstamo ya pagado. Todos mueven dinero: además del permiso de nómina exigen cochinito y acceso de edición a la
 * cuenta. Los servicios son dobles.
 */

type Perm = { recurso: string; accion: string };
const usuarios: Record<string, { rol: string; permisos: Perm[] | null; activo: boolean }> = {};

vi.mock('../src/config/env.js', async importOriginal => {
  const real = await importOriginal<typeof import('../src/config/env.js')>();
  return { ...real, ENV: { ...real.ENV, SUPABASE_URL: 'https://p.supabase.test' } };
});
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
  },
}));
vi.mock('../src/services/auth-service.js', () => ({
  verificarToken: (token: string) => {
    if (!usuarios[token]) throw new Error('token inválido');
    return { sub: token, email: `${token}@x.test`, rol: usuarios[token].rol };
  },
}));

const CUENTA_EDITABLE = '11111111-1111-4111-8111-111111111111';
const CUENTA_SOLO_VER = '22222222-2222-4222-8222-222222222222';
const CUENTA_AJENA = '33333333-3333-4333-8333-333333333333';
vi.mock('../src/services/banca-acceso-service.js', () => ({
  accesoBancas: async (_id: string, rol: string) => (rol === 'superadmin'
    ? { ver: null, editar: null }
    : { ver: new Set([CUENTA_EDITABLE, CUENTA_SOLO_VER]), editar: new Set([CUENTA_EDITABLE]) }),
}));

const s = vi.hoisted(() => ({
  pagarTrabajadorNomina: vi.fn(),
  desembolsarPrestamo: vi.fn(),
  registrarPrestamo: vi.fn(),
  anularPrestamo: vi.fn(),
  bancaDePagoPrestamo: vi.fn(),
}));
vi.mock('../src/services/nomina-pago-trabajador-service.js', () => ({ pagarTrabajadorNomina: s.pagarTrabajadorNomina }));
vi.mock('../src/services/nomina-prestamo-pago-service.js', () => ({ desembolsarPrestamo: s.desembolsarPrestamo, registrarPrestamo: s.registrarPrestamo }));
vi.mock('../src/services/nomina-prestamo-pago-lectura.js', () => ({ bancaDePagoPrestamo: s.bancaDePagoPrestamo }));
vi.mock('../src/services/nomina-prestamo-service.js', () => ({
  listarPrestamos: vi.fn(), actualizarPrestamo: vi.fn(), anularPrestamo: s.anularPrestamo,
}));
vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  clienteIp: () => '127.0.0.1',
}));

const { default: nominaRouter } = await import('../src/routes/nomina.js');
const { logger } = await import('../src/utils/logger.js');

const NOMINA = '44444444-4444-4444-8444-444444444444';
const TRABAJADOR = '55555555-5555-4555-8555-555555555555';
const PRESTAMO = '66666666-6666-4666-8666-666666666666';
const COMPROBANTE = 'https://p.supabase.test/storage/v1/object/public/comprobantes/pago.jpg';
const permisos = (...pares: Array<[string, string]>): Perm[] => pares.map(([recurso, accion]) => ({ recurso, accion }));
const cuerpoTrabajador = (bancaId = CUENTA_EDITABLE) => ({ fecha: '2026-10-09', bancas: [{ moneda: 'USD', bancaId }], comprobantes: [COMPROBANTE] });
const cuerpoDesembolso = (bancaId = CUENTA_EDITABLE) => ({ bancaId, fecha: '2026-10-09', comprobantes: [COMPROBANTE] });
const cuerpoPrestamo = (desembolso?: unknown) => ({
  trabajadorId: TRABAJADOR, tipo: 'PRESTAMO', montoUsd: 100, cuotaSemanalUsd: null, fecha: '2026-10-09', ...(desembolso ? { desembolso } : {}),
});

let servidor: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/nomina', nominaRouter);
  await new Promise<void>(resolve => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => { servidor.close(); });

beforeEach(() => {
  for (const k of Object.keys(usuarios)) delete usuarios[k];
  usuarios.root = { rol: 'superadmin', permisos: null, activo: true };
  usuarios.soloNomina = { rol: 'administracion', permisos: permisos(['nomina', 'ver'], ['nomina', 'crear'], ['nomina', 'editar']), activo: true };
  usuarios.soloWallet = { rol: 'administracion', permisos: permisos(['cochinito', 'ver'], ['cochinito', 'crear']), activo: true };
  usuarios.tesorero = {
    rol: 'administracion',
    permisos: permisos(['nomina', 'ver'], ['nomina', 'crear'], ['nomina', 'editar'], ['cochinito', 'ver'], ['cochinito', 'crear'], ['cochinito', 'editar']),
    activo: true,
  };
  usuarios.tesoreroSinEditar = {
    rol: 'administracion', permisos: permisos(['nomina', 'ver'], ['nomina', 'crear'], ['nomina', 'editar'], ['cochinito', 'ver'], ['cochinito', 'crear']), activo: true,
  };
  for (const f of Object.values(s)) f.mockReset();
  s.pagarTrabajadorNomina.mockResolvedValue({ nomina: { id: NOMINA }, yaPagada: false });
  s.desembolsarPrestamo.mockResolvedValue({ prestamo: { id: PRESTAMO }, yaPagado: false });
  s.registrarPrestamo.mockResolvedValue({ prestamo: { id: PRESTAMO } });
  s.anularPrestamo.mockResolvedValue({ ok: true });
  s.bancaDePagoPrestamo.mockResolvedValue(null);
  vi.mocked(logger.info).mockClear();
});

async function llamar(metodo: string, ruta: string, usuario: string | null, body?: unknown) {
  const res = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(usuario ? { Authorization: `Bearer ${usuario}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

const pagarTrabajador = (usuario: string | null, body: unknown = cuerpoTrabajador(), trabajador = TRABAJADOR) =>
  llamar('POST', `/api/nomina/nominas/${NOMINA}/trabajadores/${trabajador}/pagar`, usuario, body);

describe('POST /nominas/:id/trabajadores/:trabajadorId/pagar', () => {
  it('sin sesión: 401; con solo nómina o solo Wallet: 403 y no se paga', async () => {
    expect((await pagarTrabajador(null)).status).toBe(401);
    expect((await pagarTrabajador('soloNomina')).status).toBe(403);
    expect((await pagarTrabajador('soloWallet')).status).toBe(403);
    expect(s.pagarTrabajadorNomina).not.toHaveBeenCalled();
  });

  it('con nomina.editar + cochinito.crear y acceso a la cuenta: paga y pasa nómina, trabajador, cuerpo y usuario', async () => {
    const r = await pagarTrabajador('tesoreroSinEditar');
    expect(r.status).toBe(200);
    expect(s.pagarTrabajadorNomina).toHaveBeenCalledWith(NOMINA, TRABAJADOR, expect.objectContaining({ fecha: '2026-10-09', comprobantes: [COMPROBANTE] }), 'tesoreroSinEditar');
  });

  it('una cuenta solo de consulta o sin acceso: 403; superadmin no tiene restricción de cuentas', async () => {
    expect((await pagarTrabajador('tesorero', cuerpoTrabajador(CUENTA_SOLO_VER))).status).toBe(403);
    expect((await pagarTrabajador('tesorero', cuerpoTrabajador(CUENTA_AJENA))).status).toBe(403);
    expect(s.pagarTrabajadorNomina).not.toHaveBeenCalled();
    expect((await pagarTrabajador('root', cuerpoTrabajador(CUENTA_AJENA))).status).toBe(200);
  });

  it('ids que no son uuid o comprobante de otro sitio: 400 sin llegar al servicio', async () => {
    expect((await pagarTrabajador('root', cuerpoTrabajador(), 'abc')).status).toBe(400);
    expect((await pagarTrabajador('root', { ...cuerpoTrabajador(), comprobantes: ['https://evil.test/a.jpg'] })).status).toBe(400);
    expect(s.pagarTrabajadorNomina).not.toHaveBeenCalled();
  });

  it('un fallo del servicio se responde con su código; el evento se registra solo si se pagó ahora y sin cuentas ni montos', async () => {
    s.pagarTrabajadorNomina.mockResolvedValueOnce({ error: 'Saldo insuficiente', codigo: 409 });
    const fallo = await pagarTrabajador('root');
    expect(fallo.status).toBe(409);
    expect(fallo.json).toEqual({ error: 'Saldo insuficiente' });
    await pagarTrabajador('root');
    s.pagarTrabajadorNomina.mockResolvedValue({ nomina: { id: NOMINA }, yaPagada: true });
    await pagarTrabajador('root');
    const eventos = vi.mocked(logger.info).mock.calls.filter(c => (c[0] as { evento?: string }).evento === 'nomina_trabajador_pagado');
    expect(eventos).toHaveLength(1);
    expect(JSON.stringify(eventos)).not.toContain(CUENTA_EDITABLE);
  });
});

describe('POST /prestamos/:id/pagar', () => {
  const pagar = (usuario: string | null, body: unknown = cuerpoDesembolso()) => llamar('POST', `/api/nomina/prestamos/${PRESTAMO}/pagar`, usuario, body);

  it('exige nomina.editar Y cochinito.crear y acceso de edición a la cuenta', async () => {
    expect((await pagar(null)).status).toBe(401);
    expect((await pagar('soloNomina')).status).toBe(403);
    expect((await pagar('soloWallet')).status).toBe(403);
    expect((await pagar('tesorero', cuerpoDesembolso(CUENTA_SOLO_VER))).status).toBe(403);
    expect(s.desembolsarPrestamo).not.toHaveBeenCalled();
    expect((await pagar('tesorero')).status).toBe(200);
    expect(s.desembolsarPrestamo).toHaveBeenCalledWith(PRESTAMO, expect.objectContaining({ bancaId: CUENTA_EDITABLE, tasaBs: null, comprobantes: [COMPROBANTE] }), 'tesorero');
  });

  it('cuerpo inválido (sin cuenta) o tasa no positiva: 400', async () => {
    expect((await pagar('root', { fecha: '2026-10-09' })).status).toBe(400);
    expect((await pagar('root', { ...cuerpoDesembolso(), tasaBs: 0 })).status).toBe(400);
    expect(s.desembolsarPrestamo).not.toHaveBeenCalled();
  });

  it('registra el evento solo si se pagó ahora', async () => {
    await pagar('root');
    s.desembolsarPrestamo.mockResolvedValue({ prestamo: { id: PRESTAMO }, yaPagado: true });
    await pagar('root');
    const eventos = vi.mocked(logger.info).mock.calls.filter(c => (c[0] as { evento?: string }).evento === 'nomina_prestamo_pagado');
    expect(eventos).toHaveLength(1);
  });
});

describe('POST /prestamos (con o sin pago)', () => {
  const crear = (usuario: string | null, body: unknown) => llamar('POST', '/api/nomina/prestamos', usuario, body);

  it('sin desembolso solo hace falta nomina.crear (no toca el Wallet)', async () => {
    const r = await crear('soloNomina', cuerpoPrestamo());
    expect(r.status).toBe(201);
    expect(s.registrarPrestamo).toHaveBeenCalledWith(expect.not.objectContaining({ desembolso: expect.anything() }), 'soloNomina');
  });

  it('con desembolso exige además cochinito.crear y acceso de edición a la cuenta', async () => {
    expect((await crear('soloNomina', cuerpoPrestamo(cuerpoDesembolso()))).status).toBe(403);
    expect((await crear('tesorero', cuerpoPrestamo(cuerpoDesembolso(CUENTA_SOLO_VER)))).status).toBe(403);
    expect((await crear('tesorero', cuerpoPrestamo(cuerpoDesembolso(CUENTA_AJENA)))).status).toBe(403);
    expect(s.registrarPrestamo).not.toHaveBeenCalled();
    const r = await crear('tesorero', cuerpoPrestamo(cuerpoDesembolso()));
    expect(r.status).toBe(201);
    expect(s.registrarPrestamo).toHaveBeenCalledWith(expect.objectContaining({ desembolso: expect.objectContaining({ bancaId: CUENTA_EDITABLE }) }), 'tesorero');
  });

  it('un desembolso mal formado: 400 sin llegar al servicio', async () => {
    expect((await crear('root', cuerpoPrestamo({ fecha: '2026-10-09' }))).status).toBe(400);
    expect(s.registrarPrestamo).not.toHaveBeenCalled();
  });

  it('devuelve la advertencia cuando el préstamo se creó pero su pago no', async () => {
    s.registrarPrestamo.mockResolvedValue({ prestamo: { id: PRESTAMO }, advertencia: 'El préstamo se registró, pero su pago no.' });
    const r = await crear('root', cuerpoPrestamo(cuerpoDesembolso()));
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ advertencia: 'El préstamo se registró, pero su pago no.' });
  });
});

describe('POST /prestamos/:id/anular con pago en el Wallet', () => {
  const anular = (usuario: string | null) => llamar('POST', `/api/nomina/prestamos/${PRESTAMO}/anular`, usuario, { motivo: 'Error de monto' });

  it('un préstamo sin pago se anula con nomina.editar (como siempre)', async () => {
    expect((await anular('soloNomina')).status).toBe(200);
    expect(s.anularPrestamo).toHaveBeenCalledWith(PRESTAMO, 'Error de monto', 'soloNomina');
  });

  it('un préstamo pagado desde el Wallet exige además cochinito.editar y acceso a la cuenta del pago', async () => {
    s.bancaDePagoPrestamo.mockResolvedValue(CUENTA_EDITABLE);
    expect((await anular('soloNomina')).status).toBe(403);
    expect((await anular('tesoreroSinEditar')).status).toBe(403);
    expect(s.anularPrestamo).not.toHaveBeenCalled();
    expect((await anular('tesorero')).status).toBe(200);
    s.bancaDePagoPrestamo.mockResolvedValue(CUENTA_AJENA);
    expect((await anular('tesorero')).status).toBe(403);
    expect((await anular('root')).status).toBe(200);
  });

  it('si no se puede leer el pago responde 503 y no anula (falla cerrado)', async () => {
    s.bancaDePagoPrestamo.mockRejectedValue(new Error('BD caída'));
    const r = await anular('root');
    expect(r.status).toBe(503);
    expect(s.anularPrestamo).not.toHaveBeenCalled();
  });
});
