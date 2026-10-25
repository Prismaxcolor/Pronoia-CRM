import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Cableado de POST /api/nomina/nominas/:id/pagar y GET /categoria-pago: pagar mueve dinero, así que exige
 * nomina.editar + cochinito.crear + acceso de edición a cada cuenta. Los servicios son dobles.
 */

type Perm = { recurso: string; accion: string };
const usuarios: Record<string, { rol: string; permisos: Perm[] | null; activo: boolean }> = {};

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

const s = vi.hoisted(() => ({ pagarNomina: vi.fn(), categoriaDePagoNomina: vi.fn() }));
vi.mock('../src/services/nomina-pago-service.js', () => ({ pagarNomina: s.pagarNomina, categoriaDePagoNomina: s.categoriaDePagoNomina }));
vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  clienteIp: () => '127.0.0.1',
}));

const { default: nominaRouter } = await import('../src/routes/nomina.js');
const { logger } = await import('../src/utils/logger.js');

const ID = '44444444-4444-4444-8444-444444444444';
const permisos = (...pares: Array<[string, string]>): Perm[] => pares.map(([recurso, accion]) => ({ recurso, accion }));
const cuerpo = (bancaId = CUENTA_EDITABLE) => ({ fecha: '2026-10-09', bancas: [{ moneda: 'USD', bancaId }] });

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
  usuarios.soloNomina = { rol: 'administracion', permisos: permisos(['nomina', 'ver'], ['nomina', 'editar']), activo: true };
  usuarios.soloWallet = { rol: 'administracion', permisos: permisos(['cochinito', 'ver'], ['cochinito', 'crear']), activo: true };
  usuarios.tesorero = { rol: 'administracion', permisos: permisos(['nomina', 'ver'], ['nomina', 'editar'], ['cochinito', 'ver'], ['cochinito', 'crear']), activo: true };
  usuarios.lector = { rol: 'administracion', permisos: permisos(['nomina', 'ver']), activo: true };
  s.pagarNomina.mockReset();
  s.categoriaDePagoNomina.mockReset();
  s.pagarNomina.mockResolvedValue({ nomina: { id: ID }, yaPagada: false });
  s.categoriaDePagoNomina.mockResolvedValue({ categoria: { id: 'c', nombre: 'NOMINA PERSONAL OPERATIVO' } });
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

const pagar = (usuario: string | null, body: unknown = cuerpo()) => llamar('POST', `/api/nomina/nominas/${ID}/pagar`, usuario, body);

describe('POST /nominas/:id/pagar: permisos', () => {
  it('sin sesión: 401', async () => {
    expect((await pagar(null)).status).toBe(401);
  });

  it('exige nomina.editar Y cochinito.crear: con solo uno de los dos, 403 y no se paga', async () => {
    expect((await pagar('soloNomina')).status).toBe(403);
    expect((await pagar('soloWallet')).status).toBe(403);
    expect((await pagar('lector')).status).toBe(403);
    expect(s.pagarNomina).not.toHaveBeenCalled();
  });

  it('con ambos permisos y acceso de edición a la cuenta: paga', async () => {
    const r = await pagar('tesorero');
    expect(r.status).toBe(200);
    expect(s.pagarNomina).toHaveBeenCalledWith(ID, expect.objectContaining({ fecha: '2026-10-09' }), 'tesorero');
  });

  it('superadmin paga sin restricciones de cuenta', async () => {
    expect((await pagar('root', cuerpo(CUENTA_AJENA))).status).toBe(200);
  });

  it('una cuenta solo de consulta o sin acceso: 403 y no se paga', async () => {
    expect((await pagar('tesorero', cuerpo(CUENTA_SOLO_VER))).status).toBe(403);
    expect((await pagar('tesorero', cuerpo(CUENTA_AJENA))).status).toBe(403);
    expect(s.pagarNomina).not.toHaveBeenCalled();
  });
});

describe('POST /nominas/:id/pagar: validación y respuesta', () => {
  it('cuerpo inválido o id que no es uuid: 400 sin llegar al servicio', async () => {
    expect((await pagar('root', { fecha: 'hoy', bancas: [] })).status).toBe(400);
    expect((await llamar('POST', '/api/nomina/nominas/abc/pagar', 'root', cuerpo())).status).toBe(400);
    expect(s.pagarNomina).not.toHaveBeenCalled();
  });

  it('un fallo del servicio se responde con su código', async () => {
    s.pagarNomina.mockResolvedValue({ error: 'Saldo insuficiente', codigo: 409 });
    const r = await pagar('root');
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: 'Saldo insuficiente' });
  });

  it('registra el evento solo si se pagó ahora (no en un reintento) y sin datos de montos ni cuentas', async () => {
    await pagar('root');
    s.pagarNomina.mockResolvedValue({ nomina: { id: ID }, yaPagada: true });
    await pagar('root');
    const llamadas = vi.mocked(logger.info).mock.calls.filter(c => (c[0] as { evento?: string }).evento === 'nomina_pagada');
    expect(llamadas).toHaveLength(1);
    expect(JSON.stringify(llamadas)).not.toContain(CUENTA_EDITABLE);
  });
});

describe('GET /categoria-pago', () => {
  it('con nomina.ver devuelve la categoría del tipo', async () => {
    const r = await llamar('GET', '/api/nomina/categoria-pago?tipo=OPERATIVO', 'lector');
    expect(r.status).toBe(200);
    expect(s.categoriaDePagoNomina).toHaveBeenCalledWith('OPERATIVO');
  });

  it('tipo inválido: 400; sin permiso de nómina: 403', async () => {
    expect((await llamar('GET', '/api/nomina/categoria-pago?tipo=X', 'root')).status).toBe(400);
    expect((await llamar('GET', '/api/nomina/categoria-pago?tipo=OPERATIVO', 'soloWallet')).status).toBe(403);
  });
});
