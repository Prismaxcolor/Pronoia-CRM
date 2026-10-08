import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * GET /api/proveedores/saldos y /api/clientes/saldos a través de los routers reales: autenticación,
 * permisos (proveedores:ver / clientes:ver, igual que el estado de cuenta), orden de rutas frente a '/:id'
 * y mapeo de errores. El servicio de saldos es un doble.
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
    rpc: async () => ({ data: null, error: null }),
  },
}));

vi.mock('../src/services/auth-service.js', () => ({
  verificarToken: (token: string) => {
    if (!usuarios[token]) throw new Error('token inválido');
    return { sub: token, email: `${token}@x.test`, rol: usuarios[token].rol };
  },
}));

const servicios = vi.hoisted(() => ({
  obtenerSaldos: vi.fn(),
  obtenerEstadoCuenta: vi.fn(),
}));

vi.mock('../src/services/saldos-service.js', () => ({
  obtenerSaldos: servicios.obtenerSaldos,
  invalidarCacheSaldos: vi.fn(),
}));
vi.mock('../src/services/estado-cuenta-service.js', () => ({ obtenerEstadoCuenta: servicios.obtenerEstadoCuenta }));
vi.mock('../src/services/proveedor-service.js', () => ({
  listarProveedores: vi.fn(async () => []), crearProveedor: vi.fn(), actualizarProveedor: vi.fn(),
  desactivarProveedor: vi.fn(), reactivarProveedor: vi.fn(), borrarProveedor: vi.fn(),
}));
vi.mock('../src/services/cliente-service.js', () => ({
  listarClientes: vi.fn(async () => []), crearCliente: vi.fn(), actualizarCliente: vi.fn(),
  desactivarCliente: vi.fn(), reactivarCliente: vi.fn(), borrarCliente: vi.fn(),
}));
vi.mock('../src/services/telegram-link-service.js', () => ({ generarLinkTelegram: vi.fn() }));
vi.mock('../src/services/telegram-estado-cuenta-service.js', () => ({ enviarEstadoCuentaTelegram: vi.fn() }));
vi.mock('../src/services/nota-ajuste-service.js', () => ({ crearNotaAjuste: vi.fn(), anularNotaAjuste: vi.fn(), anularNotaAjusteConLlave: vi.fn(), obtenerNotaAjuste: vi.fn() }));
vi.mock('../src/services/nota-ajuste-cliente-service.js', () => ({ crearNotaAjusteCliente: vi.fn(), anularNotaAjusteCliente: vi.fn(), anularNotaAjusteClienteConLlave: vi.fn(), obtenerNotaAjusteCliente: vi.fn() }));
vi.mock('../src/services/pago-detalle-service.js', () => ({ obtenerPagoDetalle: vi.fn() }));
vi.mock('../src/services/cruce-service.js', () => ({ listarAdelantosDisponibles: vi.fn() }));

const { default: proveedoresRouter } = await import('../src/routes/proveedores.js');
const { default: clientesRouter } = await import('../src/routes/clientes.js');

let servidor: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/proveedores', proveedoresRouter);
  app.use('/api/clientes', clientesRouter);
  await new Promise<void>(resolve => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => { servidor.close(); });

beforeEach(() => {
  for (const k of Object.keys(usuarios)) delete usuarios[k];
  usuarios.admin = { rol: 'superadmin', permisos: null, activo: true };
  usuarios.trabajador = { rol: 'trabajador', permisos: null, activo: true };
  usuarios.administracion = { rol: 'administracion', permisos: null, activo: true };
  usuarios.inactivo = { rol: 'trabajador', permisos: null, activo: false };
  usuarios.sinPermiso = { rol: 'trabajador', permisos: [{ recurso: 'productos', accion: 'ver' }], activo: true };
  for (const f of Object.values(servicios)) f.mockReset();
});

async function pedir(ruta: string, usuario: string | null) {
  const res = await fetch(`${base}${ruta}`, { headers: usuario ? { Authorization: `Bearer ${usuario}` } : {} });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

describe.each([
  ['proveedores', 'proveedor'],
  ['clientes', 'cliente'],
] as const)('GET /api/%s/saldos', (recurso, tipo) => {
  const url = `/api/${recurso}/saldos`;

  it('sin sesion 401; usuario inactivo 401', async () => {
    expect((await pedir(url, null)).status).toBe(401);
    expect((await pedir(url, 'inactivo')).status).toBe(401);
    expect(servicios.obtenerSaldos).not.toHaveBeenCalled();
  });

  it('matriz de permisos: superadmin, administracion y trabajador (con el permiso por defecto de su rol) lo ven', async () => {
    servicios.obtenerSaldos.mockResolvedValue({ tipo, saldos: [], totales: {}, calculadoEn: 'x' });
    for (const u of ['admin', 'administracion', 'trabajador']) {
      const r = await pedir(url, u);
      expect(r.status, u).toBe(200);
      expect(r.json?.tipo).toBe(tipo);
    }
    expect(servicios.obtenerSaldos).toHaveBeenCalledWith(tipo);
  });

  it('un usuario con permisos personalizados sin ver la entidad recibe 403 y no se calcula nada', async () => {
    const r = await pedir(url, 'sinPermiso');
    expect(r.status).toBe(403);
    expect(servicios.obtenerSaldos).not.toHaveBeenCalled();
  });

  it('mismo permiso que el estado de cuenta de la entidad', async () => {
    servicios.obtenerSaldos.mockResolvedValue({ tipo, saldos: [], totales: {}, calculadoEn: 'x' });
    servicios.obtenerEstadoCuenta.mockResolvedValue({ entidad: {}, entradas: [], totales: {} });
    for (const u of Object.keys(usuarios)) {
      const a = await pedir(url, u);
      const b = await pedir(`/api/${recurso}/11111111-1111-4111-8111-111111111111/estado-cuenta`, u);
      expect(a.status, u).toBe(b.status);
    }
  });

  it('/saldos no se confunde con una ruta /:id (no pasa por el estado de cuenta)', async () => {
    servicios.obtenerSaldos.mockResolvedValue({ tipo, saldos: [], totales: {}, calculadoEn: 'x' });
    await pedir(url, 'admin');
    expect(servicios.obtenerEstadoCuenta).not.toHaveBeenCalled();
  });

  it('un fallo del calculo responde 503 sin filtrar detalles internos', async () => {
    servicios.obtenerSaldos.mockRejectedValue(new Error('secreto interno'));
    const r = await pedir(url, 'admin');
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.json)).not.toContain('secreto');
    expect(r.json?.error).toBeTruthy();
  });
});
