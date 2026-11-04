import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * GET /api/vehiculos lo puede listar quien tenga vehiculos:ver O pesaje:ver (el selector del pesaje).
 * Los permisos personalizados reemplazan a los del rol, por eso 'vehiculos' puede faltar.
 */

const usuarios: Record<string, { rol: string; permisos: unknown; activo: boolean }> = {};

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

const listarVehiculos = vi.hoisted(() => vi.fn());
vi.mock('../src/services/vehiculo-service.js', () => ({
  listarVehiculos,
  crearVehiculo: vi.fn(),
  actualizarVehiculo: vi.fn(),
  desactivarVehiculo: vi.fn(),
  reactivarVehiculo: vi.fn(),
  eliminarVehiculo: vi.fn(),
}));

const { default: vehiculosRouter } = await import('../src/routes/vehiculo.js');

let servidor: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/vehiculos', vehiculosRouter);
  await new Promise<void>(resolve => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => { servidor.close(); });

beforeEach(() => {
  for (const k of Object.keys(usuarios)) delete usuarios[k];
  listarVehiculos.mockReset();
  listarVehiculos.mockResolvedValue([]);
});

const get = async (usuario: string | null) =>
  (await fetch(`${base}/api/vehiculos`, { headers: usuario ? { Authorization: `Bearer ${usuario}` } : {} })).status;

describe('GET /api/vehiculos', () => {
  it('sin sesion: 401', async () => {
    expect(await get(null)).toBe(401);
  });

  it('permisos personalizados con pesaje:ver pero sin vehiculos: 200', async () => {
    usuarios.dioni = { rol: 'administracion', permisos: [{ recurso: 'pesaje', accion: 'ver' }], activo: true };
    expect(await get('dioni')).toBe(200);
  });

  it('permisos personalizados con vehiculos:ver pero sin pesaje: 200', async () => {
    usuarios.v = { rol: 'trabajador', permisos: [{ recurso: 'vehiculos', accion: 'ver' }], activo: true };
    expect(await get('v')).toBe(200);
  });

  it('permisos personalizados sin vehiculos ni pesaje: 403', async () => {
    usuarios.otro = { rol: 'administracion', permisos: [{ recurso: 'dashboard', accion: 'ver' }], activo: true };
    expect(await get('otro')).toBe(403);
  });

  it('rol sin personalizados (trabajador y administracion): 200', async () => {
    usuarios.t = { rol: 'trabajador', permisos: null, activo: true };
    usuarios.a = { rol: 'administracion', permisos: null, activo: true };
    expect(await get('t')).toBe(200);
    expect(await get('a')).toBe(200);
  });

  it('usuario inactivo: 401', async () => {
    usuarios.off = { rol: 'trabajador', permisos: null, activo: false };
    expect(await get('off')).toBe(401);
  });
});
