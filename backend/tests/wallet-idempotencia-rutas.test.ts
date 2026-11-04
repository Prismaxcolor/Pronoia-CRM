import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Idempotencia al crear en Wallet: POST /movimientos/mesa-cambio y POST /movimientos con el mismo clientRequestId
 * ejecutan el servicio UNA vez. El almacén de idempotencia es un doble en memoria; aquí se prueba el cableado.
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
  crearTransferenciaMesa: vi.fn(),
  registrarMovimiento: vi.fn(),
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
  idsBancasDeMovimiento: async () => [],
  concederBancaAUsuario: vi.fn(),
  listarBancasDeUsuario: vi.fn(),
  reemplazarBancasDeUsuario: vi.fn(),
}));
vi.mock('../src/services/transferencia-mesa-service.js', () => ({
  crearTransferenciaMesa: s.crearTransferenciaMesa,
  completarTransferenciaMesa: vi.fn(),
}));
vi.mock('../src/services/movimiento-comision-service.js', () => ({
  registrarMovimiento: s.registrarMovimiento,
  comisionBancariaDisponible: vi.fn(async () => true),
}));
vi.mock('../src/services/categoria-service.js', () => ({
  validarCategoriaDeMovimiento: vi.fn(async () => null),
  aplicarCategoriaSiFalta: vi.fn(async (r: unknown) => r),
}));
vi.mock('../src/services/banca-service.js', () => ({
  listarBancas: vi.fn(), listarMovimientos: vi.fn(), crearBanca: vi.fn(), actualizarBanca: vi.fn(), archivarBanca: vi.fn(),
  desarchivarBanca: vi.fn(), obtenerDetalleMovimiento: vi.fn(), leerTelegramChatIdBanca: vi.fn(),
}));
vi.mock('../src/services/movimiento-edicion-service.js', () => ({ anularMovimientoBanca: vi.fn(), editarMovimientoBanca: vi.fn() }));
vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  clienteIp: () => '127.0.0.1',
}));

const { default: mesaRouter } = await import('../src/routes/transferencia-mesa.js');
const { default: cochinitoRouter } = await import('../src/routes/cochinito.js');

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const REQ = '44444444-4444-4444-8444-444444444444';

let servidor: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/cochinito', mesaRouter);
  app.use('/api/cochinito', cochinitoRouter);
  await new Promise<void>(resolve => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => { servidor.close(); });

beforeEach(() => {
  guardadas.clear();
  s.crearTransferenciaMesa.mockReset();
  s.registrarMovimiento.mockReset();
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

describe('POST /api/cochinito/movimientos/mesa-cambio', () => {
  const cuerpo = { cambistaId: U1, bancaId: U2, bancaDestinoId: U3, monto: 100, fecha: '2026-10-11' };
  const creada = { transferencia: { movimiento: { id: 'm-1' }, asientoId: 'a-1' } };

  it('con el mismo clientRequestId ejecuta el servicio una vez: la segunda llamada responde 200 con repetida', async () => {
    s.crearTransferenciaMesa.mockResolvedValue(creada);
    const a = await post('/api/cochinito/movimientos/mesa-cambio', { ...cuerpo, clientRequestId: REQ });
    const b = await post('/api/cochinito/movimientos/mesa-cambio', { ...cuerpo, clientRequestId: REQ });
    expect(a.status).toBe(201);
    expect(a.json).not.toHaveProperty('repetida');
    expect(b.status).toBe(200);
    expect(b.json).toMatchObject({ repetida: true, transferencia: { movimiento: { id: 'm-1' } } });
    expect(s.crearTransferenciaMesa).toHaveBeenCalledTimes(1);
  });

  it('sin clientRequestId se comporta como siempre (cada llamada crea)', async () => {
    s.crearTransferenciaMesa.mockResolvedValue(creada);
    expect((await post('/api/cochinito/movimientos/mesa-cambio', cuerpo)).status).toBe(201);
    expect((await post('/api/cochinito/movimientos/mesa-cambio', cuerpo)).status).toBe(201);
    expect(s.crearTransferenciaMesa).toHaveBeenCalledTimes(2);
  });

  it('un fallo de negocio conserva su codigo', async () => {
    s.crearTransferenciaMesa.mockResolvedValue({ error: 'Saldo insuficiente', codigo: 409 });
    const r = await post('/api/cochinito/movimientos/mesa-cambio', { ...cuerpo, clientRequestId: REQ });
    expect(r).toMatchObject({ status: 409, json: { error: 'Saldo insuficiente' } });
  });

  it('una fecha inexistente da 400 claro, no 500', async () => {
    const r = await post('/api/cochinito/movimientos/mesa-cambio', { ...cuerpo, fecha: '2026-02-31' });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.json)).toContain('La fecha no existe en el calendario.');
    expect(s.crearTransferenciaMesa).not.toHaveBeenCalled();
  });
});

describe('POST /api/cochinito/movimientos', () => {
  const cuerpo = { tipo: 'egreso', bancaId: U2, monto: 10, moneda: 'VES', fecha: '2026-10-11', llevaComision: true };
  const registrado = { movimiento: { id: 'm-9', tipo: 'egreso' }, comision: { monto: 14, movimientoId: 'c-9' } };

  it('con el mismo clientRequestId registra (y cobra la comision) una sola vez', async () => {
    s.registrarMovimiento.mockResolvedValue(registrado);
    const a = await post('/api/cochinito/movimientos', { ...cuerpo, clientRequestId: REQ });
    const b = await post('/api/cochinito/movimientos', { ...cuerpo, clientRequestId: REQ });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.json).toMatchObject({ repetida: true, movimiento: { id: 'm-9' } });
    expect(s.registrarMovimiento).toHaveBeenCalledTimes(1);
  });

  it('el fallo del servicio responde su codigo', async () => {
    s.registrarMovimiento.mockResolvedValue({ error: 'Indica si lleva comisión', codigo: 400 });
    expect(await post('/api/cochinito/movimientos', { ...cuerpo, clientRequestId: REQ })).toMatchObject({ status: 400 });
  });
});
