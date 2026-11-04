import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Límite del cuerpo JSON: 100 kb global, 1 mb solo en la nómina (y solo con sesión). Se prueba también contra la app real
 * para asegurar que el parser global no la rechaza antes de llegar a su router.
 */

type Perm = { recurso: string; accion: string };
const usuarios: Record<string, { rol: string; permisos: Perm[] | null; activo: boolean }> = {
  root: { rol: 'superadmin', permisos: null, activo: true },
};

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
const guardar = vi.hoisted(() => vi.fn());
vi.mock('../src/services/nomina-escritura-service.js', () => ({
  guardarNomina: guardar, cerrarNomina: vi.fn(), anularNomina: vi.fn(),
}));
vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  clienteIp: () => '127.0.0.1',
}));

const { default: app } = await import('../src/app.js');
const { LIMITE_JSON_GLOBAL, LIMITE_JSON_NOMINA, jsonGlobalSaltando, jsonNomina } = await import('../src/middlewares/json-por-ruta.js');

let servidor: Server;
let base = '';

beforeAll(async () => {
  await new Promise<void>(resolve => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => { servidor.close(); });

const cuerpoDe = (kb: number) => JSON.stringify({ relleno: 'x'.repeat(kb * 1024) });
const enviar = (ruta: string, kb: number, token?: string) =>
  fetch(`${base}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpoDe(kb),
  });

describe('límites declarados', () => {
  it('100 kb global y 1 mb en la nómina', () => {
    expect(LIMITE_JSON_GLOBAL).toBe('100kb');
    expect(LIMITE_JSON_NOMINA).toBe('1mb');
  });
});

describe('app real', () => {
  it('el resto de rutas sigue limitado a 100 kb (413)', async () => {
    expect((await enviar('/api/auth/login', 200)).status).toBe(413);
  });

  it('la nómina acepta un cuerpo mayor a 100 kb de un usuario con sesión (llega a la validación: 400, no 413)', async () => {
    const r = await enviar('/api/nomina/nominas', 300, 'root');
    expect(r.status).toBe(400);
    expect(guardar).not.toHaveBeenCalled();
  });

  it('la nómina rechaza más de 1 mb (413)', async () => {
    expect((await enviar('/api/nomina/nominas', 1200, 'root')).status).toBe(413);
  });

  it('sin sesión la nómina responde 401 sin leer el cuerpo grande', async () => {
    expect((await enviar('/api/nomina/nominas', 300)).status).toBe(401);
  });
});

describe('jsonGlobalSaltando', () => {
  it('omite solo las rutas indicadas (y sus subrutas), no las que solo empiezan igual', async () => {
    const mini = express();
    mini.use(jsonGlobalSaltando(['/api/nomina'], '1kb'));
    const eco: express.RequestHandler = (req, res) => { res.json({ parseado: req.body !== undefined && Object.keys(req.body ?? {}).length > 0 }); };
    mini.post('/api/nomina/x', eco);
    mini.post('/api/nominas-otra', eco);
    const srv: Server = await new Promise(resolve => { const s = mini.listen(0, () => resolve(s)); });
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const post = (ruta: string) => fetch(`${url}${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: 1 }) });
    expect(await (await post('/api/nomina/x')).json()).toEqual({ parseado: false });
    expect(await (await post('/api/nominas-otra')).json()).toEqual({ parseado: true });
    srv.close();
    expect(typeof jsonNomina).toBe('function');
  });
});
