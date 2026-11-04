import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * POST /nominas/:id/anular: si la nómina se pagó desde el Wallet, anularla revierte egresos de cuentas, así que
 * además de nomina.eliminar exige cochinito.editar y acceso de edición a las cuentas del pago. Sin pago: sin cambio.
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
vi.mock('../src/services/banca-acceso-service.js', () => ({
  accesoBancas: async (_id: string, rol: string) => (rol === 'superadmin'
    ? { ver: null, editar: null }
    : { ver: new Set([CUENTA_EDITABLE, CUENTA_SOLO_VER]), editar: new Set([CUENTA_EDITABLE]) }),
}));

const s = vi.hoisted(() => ({ anularNomina: vi.fn(), bancasDePagoNomina: vi.fn() }));
vi.mock('../src/services/nomina-escritura-service.js', () => ({
  anularNomina: s.anularNomina, cerrarNomina: vi.fn(), guardarNomina: vi.fn(),
}));
vi.mock('../src/services/nomina-pago-lectura.js', () => ({
  bancasDePagoNomina: s.bancasDePagoNomina, pagosDeNomina: vi.fn(),
}));
vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  clienteIp: () => '127.0.0.1',
}));

const { default: nominaRouter } = await import('../src/routes/nomina.js');

const ID = '44444444-4444-4444-8444-444444444444';
const permisos = (...pares: Array<[string, string]>): Perm[] => pares.map(([recurso, accion]) => ({ recurso, accion }));
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
  usuarios.soloNomina = { rol: 'administracion', permisos: permisos(['nomina', 'ver'], ['nomina', 'eliminar']), activo: true };
  usuarios.conWalletVer = { rol: 'administracion', permisos: permisos(['nomina', 'eliminar'], ['cochinito', 'ver']), activo: true };
  usuarios.completo = { rol: 'administracion', permisos: permisos(['nomina', 'eliminar'], ['cochinito', 'editar']), activo: true };
  s.anularNomina.mockReset();
  s.bancasDePagoNomina.mockReset();
  s.anularNomina.mockResolvedValue({ nomina: { id: ID } });
  s.bancasDePagoNomina.mockResolvedValue([]);
});

async function anular(usuario: string) {
  const res = await fetch(`${base}/api/nomina/nominas/${ID}/anular`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${usuario}` },
    body: JSON.stringify({ motivo: 'Error de captura' }),
  });
  return res.status;
}

describe('POST /nominas/:id/anular', () => {
  it('nómina sin pago del Wallet: solo nomina.eliminar, como antes', async () => {
    expect(await anular('soloNomina')).toBe(200);
    expect(s.anularNomina).toHaveBeenCalled();
  });

  it('nómina pagada: sin cochinito.editar, 403 y no se anula', async () => {
    s.bancasDePagoNomina.mockResolvedValue([CUENTA_EDITABLE]);
    expect(await anular('soloNomina')).toBe(403);
    expect(await anular('conWalletVer')).toBe(403);
    expect(s.anularNomina).not.toHaveBeenCalled();
  });

  it('nómina pagada: con cochinito.editar pero una cuenta solo de consulta, 403', async () => {
    s.bancasDePagoNomina.mockResolvedValue([CUENTA_EDITABLE, CUENTA_SOLO_VER]);
    expect(await anular('completo')).toBe(403);
    expect(s.anularNomina).not.toHaveBeenCalled();
  });

  it('nómina pagada: con permiso y acceso de edición a las cuentas, anula', async () => {
    s.bancasDePagoNomina.mockResolvedValue([CUENTA_EDITABLE]);
    expect(await anular('completo')).toBe(200);
    expect(s.anularNomina).toHaveBeenCalledWith(ID, 'Error de captura', 'completo');
  });

  it('superadmin anula una nómina pagada', async () => {
    s.bancasDePagoNomina.mockResolvedValue([CUENTA_SOLO_VER]);
    expect(await anular('root')).toBe(200);
  });

  it('si no se pueden leer los pagos, falla cerrado con 503', async () => {
    s.bancasDePagoNomina.mockRejectedValue(new Error('bd caída'));
    expect(await anular('completo')).toBe(503);
    expect(s.anularNomina).not.toHaveBeenCalled();
  });
});
