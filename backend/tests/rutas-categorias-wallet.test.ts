import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Cableado de las rutas de categorías y reportes del Wallet (router real) y de la validación de categoría
 * al crear un movimiento (router real de cochinito). Los servicios son dobles: aquí solo se prueba
 * autorización, validación de entrada y mapeo de estados HTTP.
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
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock('../src/services/auth-service.js', () => ({
  verificarToken: (token: string) => {
    if (!usuarios[token]) throw new Error('token inválido');
    return { sub: token, email: `${token}@x.test`, rol: usuarios[token].rol };
  },
}));

const editables = vi.hoisted(() => ({ valor: null as ReadonlySet<string> | null }));
const s = vi.hoisted(() => ({
  listarCategorias: vi.fn(),
  crearCategoria: vi.fn(),
  actualizarCategoria: vi.fn(),
  asignarCategoriaMovimiento: vi.fn(),
  validarCategoriaDeMovimiento: vi.fn(),
  aplicarCategoriaSiFalta: vi.fn(),
  obtenerReporteCuenta: vi.fn(),
  obtenerReporteCategorias: vi.fn(),
  bancasPermitidas: vi.fn(),
  registrarMovimiento: vi.fn(),
}));

vi.mock('../src/services/categoria-service.js', () => ({
  listarCategorias: s.listarCategorias,
  crearCategoria: s.crearCategoria,
  actualizarCategoria: s.actualizarCategoria,
  asignarCategoriaMovimiento: s.asignarCategoriaMovimiento,
  validarCategoriaDeMovimiento: s.validarCategoriaDeMovimiento,
  aplicarCategoriaSiFalta: s.aplicarCategoriaSiFalta,
}));
vi.mock('../src/services/reporte-wallet-service.js', () => ({
  obtenerReporteCuenta: s.obtenerReporteCuenta,
  obtenerReporteCategorias: s.obtenerReporteCategorias,
}));
vi.mock('../src/services/banca-acceso-service.js', () => ({
  bancasPermitidas: s.bancasPermitidas,
  accesoBancas: async (...args: unknown[]) => ({ ver: await s.bancasPermitidas(...args), editar: editables.valor }),
  concederBancaAUsuario: vi.fn(),
  idsBancasDeMovimiento: vi.fn(async () => ['b-del-movimiento']),
}));
vi.mock('../src/services/edicion-autorizada-service.js', () => ({
  esSuperadminEnBd: async (id: string) => usuarios[id]?.rol === 'superadmin' && usuarios[id]?.activo === true,
  obtenerUsuarioVigente: async (id: string) => (usuarios[id] ? { rol: usuarios[id].rol, activo: usuarios[id].activo } : null),
}));
vi.mock('../src/services/banca-service.js', () => ({
  listarBancas: vi.fn(async () => []), listarMovimientos: vi.fn(async () => []), crearBanca: vi.fn(), actualizarBanca: vi.fn(),
  archivarBanca: vi.fn(), desarchivarBanca: vi.fn(), obtenerDetalleMovimiento: vi.fn(), leerTelegramChatIdBanca: vi.fn(),
}));
vi.mock('../src/services/movimiento-comision-service.js', () => ({
  registrarMovimiento: s.registrarMovimiento, comisionBancariaDisponible: vi.fn(async () => false),
}));
vi.mock('../src/services/movimiento-edicion-service.js', () => ({ anularMovimientoBanca: vi.fn(), editarMovimientoBanca: vi.fn() }));
vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  clienteIp: () => '127.0.0.1',
}));

const { default: categoriasRouter } = await import('../src/routes/categorias-wallet.js');
const { default: cochinitoRouter } = await import('../src/routes/cochinito.js');

const ID = '11111111-1111-4111-8111-111111111111';
const BANCA = '44444444-4444-4444-8444-444444444444';
const CAT = '55555555-5555-4555-8555-555555555555';
const permisos = (...pares: Array<[string, string]>): Perm[] => pares.map(([recurso, accion]) => ({ recurso, accion }));
const RANGO = 'desde=2026-10-01&hasta=2026-10-31';

let servidor: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/cochinito', categoriasRouter);
  app.use('/api/cochinito', cochinitoRouter);
  await new Promise<void>(resolve => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => { servidor.close(); });

beforeEach(() => {
  for (const k of Object.keys(usuarios)) delete usuarios[k];
  usuarios.root = { rol: 'superadmin', permisos: null, activo: true };
  usuarios.lector = { rol: 'trabajador', permisos: permisos(['cochinito', 'ver']), activo: true };
  usuarios.cajero = { rol: 'trabajador', permisos: permisos(['cochinito', 'ver'], ['cochinito', 'crear'], ['cochinito', 'editar']), activo: true };
  usuarios.nadie = { rol: 'trabajador', permisos: [], activo: true };
  editables.valor = null;
  for (const f of Object.values(s)) f.mockReset();
  s.bancasPermitidas.mockResolvedValue(null);
  s.validarCategoriaDeMovimiento.mockResolvedValue(null);
  s.aplicarCategoriaSiFalta.mockImplementation(async (r: unknown) => r);
});

async function llamar(metodo: string, ruta: string, usuario: string | null, body?: unknown) {
  const res = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(usuario ? { Authorization: `Bearer ${usuario}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

describe('categorías: permisos y validación', () => {
  it('sin sesión 401; sin permiso de ver 403', async () => {
    expect((await llamar('GET', '/api/cochinito/categorias', null)).status).toBe(401);
    expect((await llamar('GET', '/api/cochinito/categorias', 'nadie')).status).toBe(403);
    expect(s.listarCategorias).not.toHaveBeenCalled();
  });

  it('GET lista; si falta la migración responde el 503 del servicio', async () => {
    s.listarCategorias.mockResolvedValue({ categorias: [] });
    expect((await llamar('GET', '/api/cochinito/categorias', 'lector')).status).toBe(200);
    s.listarCategorias.mockResolvedValue({ error: 'falta migración', codigo: 503 });
    const r = await llamar('GET', '/api/cochinito/categorias', 'lector');
    expect(r.status).toBe(503);
    expect(r.json).toEqual({ error: 'falta migración' });
  });

  it('POST: solo con permiso de crear, valida el cuerpo y responde 201', async () => {
    const cuerpo = { nombre: 'Servicios', tipo: 'EGRESO', color: '#dc2626' };
    expect((await llamar('POST', '/api/cochinito/categorias', 'lector', cuerpo)).status).toBe(403);
    expect((await llamar('POST', '/api/cochinito/categorias', 'cajero', { nombre: '', tipo: 'EGRESO' })).status).toBe(400);
    expect((await llamar('POST', '/api/cochinito/categorias', 'cajero', { ...cuerpo, color: 'rojo' })).status).toBe(400);
    s.crearCategoria.mockResolvedValue({ categoria: { id: CAT, nombre: 'Servicios' } });
    const r = await llamar('POST', '/api/cochinito/categorias', 'cajero', cuerpo);
    expect(r.status).toBe(201);
    expect(s.crearCategoria).toHaveBeenCalledWith({ nombre: 'Servicios', tipo: 'EGRESO', color: '#DC2626', padreId: null }, 'cajero');
  });

  it('POST: nombre repetido => 409 del servicio', async () => {
    s.crearCategoria.mockResolvedValue({ error: 'Ya existe', codigo: 409 });
    expect((await llamar('POST', '/api/cochinito/categorias', 'cajero', { nombre: 'A', tipo: 'AMBOS' })).status).toBe(409);
  });

  it('PATCH: id inválido 400, sin permiso de editar 403, vacío 400, ok 200 (también para archivar)', async () => {
    expect((await llamar('PATCH', '/api/cochinito/categorias/xx', 'cajero', { nombre: 'A' })).status).toBe(400);
    expect((await llamar('PATCH', `/api/cochinito/categorias/${CAT}`, 'lector', { nombre: 'A' })).status).toBe(403);
    expect((await llamar('PATCH', `/api/cochinito/categorias/${CAT}`, 'cajero', {})).status).toBe(400);
    s.actualizarCategoria.mockResolvedValue({ categoria: { id: CAT } });
    expect((await llamar('PATCH', `/api/cochinito/categorias/${CAT}`, 'cajero', { activo: false })).status).toBe(200);
    expect(s.actualizarCategoria).toHaveBeenCalledWith(CAT, { activo: false });
  });

  it('no existe ninguna ruta para borrar categorías', async () => {
    expect((await llamar('DELETE', `/api/cochinito/categorias/${CAT}`, 'root')).status).toBe(404);
  });
});

describe('PATCH /movimientos/:id/categoria', () => {
  const url = `/api/cochinito/movimientos/${ID}/categoria`;

  it('exige permiso de editar y cuerpo con categoriaId (uuid o null)', async () => {
    expect((await llamar('PATCH', url, 'lector', { categoriaId: CAT })).status).toBe(403);
    expect((await llamar('PATCH', url, 'cajero', {})).status).toBe(400);
    expect((await llamar('PATCH', url, 'cajero', { categoriaId: 'x' })).status).toBe(400);
  });

  it('asigna o quita la categoría sin pedir llave de edición', async () => {
    s.asignarCategoriaMovimiento.mockResolvedValue({ ok: true });
    editables.valor = new Set(['b-del-movimiento']);
    expect((await llamar('PATCH', url, 'cajero', { categoriaId: CAT })).status).toBe(200);
    expect(s.asignarCategoriaMovimiento).toHaveBeenCalledWith(ID, CAT);
    expect((await llamar('PATCH', url, 'cajero', { categoriaId: null })).status).toBe(200);
    expect(s.asignarCategoriaMovimiento).toHaveBeenLastCalledWith(ID, null);
  });

  it('cuenta de solo consulta o sin acceso => 403 y no escribe', async () => {
    editables.valor = new Set<string>();
    s.bancasPermitidas.mockResolvedValue(new Set(['b-del-movimiento']));
    expect((await llamar('PATCH', url, 'cajero', { categoriaId: CAT })).status).toBe(403);
    expect(s.asignarCategoriaMovimiento).not.toHaveBeenCalled();
  });

  it('propaga el rechazo del servicio (anulado / pago / tipo)', async () => {
    editables.valor = null;
    s.asignarCategoriaMovimiento.mockResolvedValue({ error: 'Este movimiento está anulado.', codigo: 409 });
    expect((await llamar('PATCH', url, 'root', { categoriaId: CAT })).status).toBe(409);
  });
});

describe('reportes', () => {
  it('cuenta: valida el filtro (400) y entrega las cuentas permitidas al servicio', async () => {
    expect((await llamar('GET', `/api/cochinito/reportes/cuenta?${RANGO}`, 'lector')).status).toBe(400);
    expect((await llamar('GET', `/api/cochinito/reportes/cuenta?bancaId=${BANCA}&desde=2026-10-31&hasta=2026-10-01`, 'lector')).status).toBe(400);
    s.bancasPermitidas.mockResolvedValue(new Set([BANCA]));
    s.obtenerReporteCuenta.mockResolvedValue({ reporte: { filas: [] } });
    const r = await llamar('GET', `/api/cochinito/reportes/cuenta?bancaId=${BANCA}&${RANGO}`, 'lector');
    expect(r.status).toBe(200);
    expect(s.obtenerReporteCuenta).toHaveBeenCalledWith({ bancaId: BANCA, desde: '2026-10-01', hasta: '2026-10-31' }, new Set([BANCA]));
  });

  it('cuenta sin acceso: el 403 del servicio llega tal cual', async () => {
    s.obtenerReporteCuenta.mockResolvedValue({ error: 'No tienes acceso a esa cuenta/caja.', codigo: 403 });
    expect((await llamar('GET', `/api/cochinito/reportes/cuenta?bancaId=${BANCA}&${RANGO}`, 'lector')).status).toBe(403);
  });

  it('categorías: lista separada por comas, rango máximo y permiso de ver', async () => {
    expect((await llamar('GET', `/api/cochinito/reportes/categorias?${RANGO}`, 'nadie')).status).toBe(403);
    expect((await llamar('GET', '/api/cochinito/reportes/categorias?desde=2024-01-01&hasta=2026-10-31', 'lector')).status).toBe(400);
    expect((await llamar('GET', `/api/cochinito/reportes/categorias?categorias=zz&${RANGO}`, 'lector')).status).toBe(400);
    s.obtenerReporteCategorias.mockResolvedValue({ reporte: { grupos: [] } });
    const r = await llamar('GET', `/api/cochinito/reportes/categorias?categorias=${CAT},${ID}&sinCategoria=true&${RANGO}`, 'lector');
    expect(r.status).toBe(200);
    expect(s.obtenerReporteCategorias).toHaveBeenCalledWith(
      { categorias: [CAT, ID], desde: '2026-10-01', hasta: '2026-10-31', sinCategoria: true }, null,
    );
  });
});

describe('POST /movimientos con categoría', () => {
  const cuerpo = { tipo: 'egreso', bancaId: BANCA, monto: 5, moneda: 'USD', fecha: '2026-10-05', categoriaId: CAT };

  it('categoría inválida o migración pendiente: responde el código del servicio y no registra', async () => {
    s.validarCategoriaDeMovimiento.mockResolvedValue({ error: 'La categoría elegida está archivada.', codigo: 400 });
    const r = await llamar('POST', '/api/cochinito/movimientos', 'cajero', cuerpo);
    expect(r.status).toBe(400);
    expect(s.validarCategoriaDeMovimiento).toHaveBeenCalledWith(CAT, 'egreso');
    expect(s.registrarMovimiento).not.toHaveBeenCalled();
  });

  it('una transferencia con categoría se rechaza en la validación del cuerpo', async () => {
    const r = await llamar('POST', '/api/cochinito/movimientos', 'cajero', { ...cuerpo, tipo: 'transferencia', bancaDestinoId: ID });
    expect(r.status).toBe(400);
    expect(s.registrarMovimiento).not.toHaveBeenCalled();
  });

  it('categoría válida: registra y aplica la categoría si el camino por RPC no la trajo', async () => {
    s.registrarMovimiento.mockResolvedValue({ movimiento: { id: 'm1', tipo: 'egreso', categoriaId: null }, comision: null });
    s.aplicarCategoriaSiFalta.mockImplementation(async (r: { movimiento: object }) => ({ ...r, movimiento: { ...r.movimiento, categoriaId: CAT } }));
    const r = await llamar('POST', '/api/cochinito/movimientos', 'cajero', cuerpo);
    expect(r.status).toBe(201);
    expect(s.aplicarCategoriaSiFalta).toHaveBeenCalledWith(expect.objectContaining({ movimiento: expect.any(Object) }), CAT);
    expect((r.json!.movimiento as { categoriaId: string }).categoriaId).toBe(CAT);
  });
});
