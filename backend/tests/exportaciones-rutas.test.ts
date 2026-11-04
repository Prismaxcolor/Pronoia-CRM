import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

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
const s = vi.hoisted(() => ({ listarExportaciones: vi.fn() }));
vi.mock('../src/services/exportaciones-service.js', () => ({
  listarExportaciones: s.listarExportaciones, MENSAJE_EXPORTACIONES_NO_LEIDAS: 'no leídas',
}));
vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  clienteIp: () => '127.0.0.1',
}));

const { default: router } = await import('../src/routes/exportaciones.js');

const permisos = (...pares: Array<[string, string]>): Perm[] => pares.map(([recurso, accion]) => ({ recurso, accion }));
let servidor: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/exportaciones', router);
  await new Promise<void>(resolve => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => { servidor.close(); });

beforeEach(() => {
  for (const k of Object.keys(usuarios)) delete usuarios[k];
  usuarios.root = { rol: 'superadmin', permisos: null, activo: true };
  usuarios.despachador = { rol: 'trabajador', permisos: permisos(['despachos', 'ver']), activo: true };
  usuarios.facturador = { rol: 'trabajador', permisos: permisos(['despachos', 'ver'], ['facturacion', 'ver']), activo: true };
  usuarios.soloFactura = { rol: 'trabajador', permisos: permisos(['facturacion', 'ver']), activo: true };
  s.listarExportaciones.mockReset();
  s.listarExportaciones.mockResolvedValue({ exportaciones: [] });
});

const get = (token?: string) =>
  fetch(`${base}/api/exportaciones`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

describe('GET /api/exportaciones', () => {
  it('sin sesión responde 401', async () => {
    expect((await get()).status).toBe(401);
    expect(s.listarExportaciones).not.toHaveBeenCalled();
  });
  it('sin despachos:ver responde 403 aunque tenga facturación', async () => {
    expect((await get('soloFactura')).status).toBe(403);
    expect(s.listarExportaciones).not.toHaveBeenCalled();
  });
  it.each([['despachador', false], ['facturador', true], ['root', true]])('%s: puedeVerValores=%s', async (token, esperado) => {
    const r = await get(token);
    expect(r.status).toBe(200);
    expect(s.listarExportaciones).toHaveBeenCalledWith({ puedeVerValores: esperado });
  });
  it('un fallo interno responde 500 con mensaje genérico', async () => {
    s.listarExportaciones.mockRejectedValue(new Error('detalle interno'));
    const r = await get('root');
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('detalle interno');
  });
});
