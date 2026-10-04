import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Rutas nuevas del rediseño de inventario, a través del router real de Express:
 * verifica autenticación, permisos (recurso 'productos' / 'transformaciones') y el mapeo de
 * estados HTTP. Los servicios se reemplazan por dobles: aquí solo se prueba el cableado.
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
  marcarEmbalado: vi.fn(),
  anularEmbalaje: vi.fn(),
  listarEmbalajes: vi.fn(),
  actualizarLote: vi.fn(),
  listarLotes: vi.fn(),
  crearLote: vi.fn(),
  obtenerResumenInventario: vi.fn(),
  leerConfiguracionInventario: vi.fn(),
  actualizarConfiguracionInventario: vi.fn(),
  editarMermaTransformacion: vi.fn(),
  obtenerDetallePantalla: vi.fn(),
  obtenerCategoriasPantalla: vi.fn(),
  obtenerAlertasPantalla: vi.fn(),
  obtenerCostosInventario: vi.fn(),
  actualizarCostosReferencia: vi.fn(),
}));

vi.mock('../src/services/lote-embalaje-service.js', () => ({
  marcarEmbalado: servicios.marcarEmbalado,
  anularEmbalaje: servicios.anularEmbalaje,
  listarEmbalajes: servicios.listarEmbalajes,
}));
vi.mock('../src/services/lote-service.js', () => ({
  listarLotes: servicios.listarLotes,
  crearLote: servicios.crearLote,
  actualizarLote: servicios.actualizarLote,
  MENSAJE_CLASIFICACION_NO_HABILITADA: 'no habilitada',
}));
vi.mock('../src/services/inventario-resumen-service.js', () => ({ obtenerResumenInventario: servicios.obtenerResumenInventario }));
vi.mock('../src/services/inventario-pantalla-service.js', () => ({
  obtenerDetallePantalla: servicios.obtenerDetallePantalla,
  obtenerCategoriasPantalla: servicios.obtenerCategoriasPantalla,
  obtenerAlertasPantalla: servicios.obtenerAlertasPantalla,
}));
vi.mock('../src/services/inventario-costos-service.js', () => ({
  obtenerCostosInventario: servicios.obtenerCostosInventario,
  actualizarCostosReferencia: servicios.actualizarCostosReferencia,
}));
vi.mock('../src/services/configuracion-inventario-service.js', () => ({
  leerConfiguracionInventario: servicios.leerConfiguracionInventario,
  actualizarConfiguracionInventario: servicios.actualizarConfiguracionInventario,
}));
vi.mock('../src/services/merma-tipificada-service.js', () => ({
  editarMermaTransformacion: servicios.editarMermaTransformacion,
  cargarMermaDetalle: vi.fn(),
  leerMermaDetalle: vi.fn(),
  registrarMermaAlCompletar: vi.fn(),
  validarMermaContraNetos: vi.fn(),
}));
vi.mock('../src/services/inventario-service.js', () => ({ obtenerInventario: vi.fn(), obtenerInventarioAlmacen: vi.fn() }));

const { default: inventarioRouter } = await import('../src/routes/inventario.js');
const { default: lotesRouter } = await import('../src/routes/lotes.js');
const { default: transformacionesRouter } = await import('../src/routes/transformaciones.js');

const LOTE = '11111111-1111-4111-8111-111111111111';
const EMB = '22222222-2222-4222-8222-222222222222';
const TRANS = '33333333-3333-4333-8333-333333333333';

let servidor: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/inventario', inventarioRouter);
  app.use('/api/lotes', lotesRouter);
  app.use('/api/transformaciones', transformacionesRouter);
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
  for (const f of Object.values(servicios)) f.mockReset();
});

async function llamar(metodo: string, ruta: string, usuario: string | null, body?: unknown) {
  const res = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(usuario ? { Authorization: `Bearer ${usuario}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

describe('GET /api/inventario/resumen', () => {
  it('sin sesion: 401', async () => {
    expect((await llamar('GET', '/api/inventario/resumen', null)).status).toBe(401);
  });
  it('cualquier rol con productos:ver lo ve (incluida administracion)', async () => {
    servicios.obtenerResumenInventario.mockResolvedValue({ totalKg: 1 });
    for (const u of ['admin', 'trabajador', 'administracion']) {
      const r = await llamar('GET', '/api/inventario/resumen', u);
      expect(r.status, u).toBe(200);
      expect(r.json).toEqual({ resumen: { totalKg: 1 } });
    }
  });
  it('H1: solo con facturacion:ver se piden costos y precios (matriz con roles reales)', async () => {
    servicios.obtenerResumenInventario.mockResolvedValue({ totalKg: 1 });
    const esperado: Record<string, boolean> = { admin: true, administracion: true, trabajador: false };
    for (const [u, incluirValor] of Object.entries(esperado)) {
      servicios.obtenerResumenInventario.mockClear();
      await llamar('GET', '/api/inventario/resumen', u);
      expect(servicios.obtenerResumenInventario, u).toHaveBeenCalledWith({ incluirValor });
    }
  });
  it('H1: los permisos personalizados mandan sobre los del rol (se pide valor segun facturacion:ver efectivo)', async () => {
    servicios.obtenerResumenInventario.mockResolvedValue({});
    usuarios.contable = { rol: 'trabajador', permisos: [{ recurso: 'productos', accion: 'ver' }, { recurso: 'facturacion', accion: 'ver' }], activo: true };
    usuarios.adminSinFactura = { rol: 'administracion', permisos: [{ recurso: 'productos', accion: 'ver' }], activo: true };
    await llamar('GET', '/api/inventario/resumen', 'contable');
    expect(servicios.obtenerResumenInventario).toHaveBeenLastCalledWith({ incluirValor: true });
    await llamar('GET', '/api/inventario/resumen', 'adminSinFactura');
    expect(servicios.obtenerResumenInventario).toHaveBeenLastCalledWith({ incluirValor: false });
  });
  it('H1: un cliente no puede forzar incluirValor por la query', async () => {
    servicios.obtenerResumenInventario.mockResolvedValue({});
    await llamar('GET', '/api/inventario/resumen?incluirValor=true', 'trabajador');
    expect(servicios.obtenerResumenInventario).toHaveBeenLastCalledWith({ incluirValor: false });
  });
  it('sinValor=1 quita costos aunque haya facturacion:ver; sinValor invalido da 400', async () => {
    servicios.obtenerResumenInventario.mockResolvedValue({});
    for (const u of ['admin', 'administracion', 'trabajador']) {
      await llamar('GET', '/api/inventario/resumen?sinValor=1', u);
      expect(servicios.obtenerResumenInventario, u).toHaveBeenLastCalledWith({ incluirValor: false });
    }
    await llamar('GET', '/api/inventario/resumen?desde=2026-09-01&hasta=2026-09-30&sinValor=1', 'admin');
    expect(servicios.obtenerResumenInventario).toHaveBeenLastCalledWith({ desde: '2026-09-01', hasta: '2026-09-30', incluirValor: false });
    expect((await llamar('GET', '/api/inventario/resumen?sinValor=0', 'admin')).status).toBe(400);
  });
  it('un usuario inactivo no entra', async () => {
    expect((await llamar('GET', '/api/inventario/resumen', 'inactivo')).status).toBe(401);
  });
  it('rango de fechas: pasa desde/hasta al servicio y rechaza rangos invalidos', async () => {
    servicios.obtenerResumenInventario.mockResolvedValue({});
    await llamar('GET', '/api/inventario/resumen?desde=2026-09-01&hasta=2026-09-30', 'trabajador');
    expect(servicios.obtenerResumenInventario).toHaveBeenCalledWith({ desde: '2026-09-01', hasta: '2026-09-30', incluirValor: false });
    for (const q of ['desde=2026-09-01', 'desde=2026-10-02&hasta=2026-10-01', 'desde=2026-02-31&hasta=2026-03-01', 'desde=x&hasta=y']) {
      expect((await llamar('GET', `/api/inventario/resumen?${q}`, 'trabajador')).status, q).toBe(400);
    }
  });
  it('un error interno responde 500 sin filtrar detalles', async () => {
    servicios.obtenerResumenInventario.mockRejectedValue(new Error('secreto interno'));
    const r = await llamar('GET', '/api/inventario/resumen', 'trabajador');
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.json)).not.toContain('secreto');
  });
});

const PANTALLA = [
  ['detalle', 'obtenerDetallePantalla'],
  ['categorias', 'obtenerCategoriasPantalla'],
  ['alertas', 'obtenerAlertasPantalla'],
] as const;

describe.each(PANTALLA)('GET /api/inventario/pantalla/%s', (ruta, servicio) => {
  const url = `/api/inventario/pantalla/${ruta}`;
  it('sin sesion 401; usuario inactivo 401', async () => {
    expect((await llamar('GET', url, null)).status).toBe(401);
    expect((await llamar('GET', url, 'inactivo')).status).toBe(401);
    expect(servicios[servicio]).not.toHaveBeenCalled();
  });
  it('matriz de permisos: superadmin y administracion piden valor; el trabajador ve kilos pero sin valor', async () => {
    servicios[servicio].mockResolvedValue({ marca: ruta });
    const esperado: Record<string, boolean> = { admin: true, administracion: true, trabajador: false };
    for (const [u, incluirValor] of Object.entries(esperado)) {
      servicios[servicio].mockClear();
      const r = await llamar('GET', url, u);
      expect(r.status, u).toBe(200);
      expect(r.json).toEqual({ [ruta]: { marca: ruta } });
      expect(servicios[servicio], u).toHaveBeenCalledWith({ incluirValor });
    }
  });
  it('sin productos:ver no entra, aunque tenga facturacion:ver', async () => {
    usuarios.contable = { rol: 'trabajador', permisos: [{ recurso: 'facturacion', accion: 'ver' }], activo: true };
    expect((await llamar('GET', url, 'contable')).status).toBe(403);
    expect(servicios[servicio]).not.toHaveBeenCalled();
  });
  it('un cliente no puede forzar incluirValor por la query', async () => {
    servicios[servicio].mockResolvedValue({});
    await llamar('GET', `${url}?incluirValor=true`, 'trabajador');
    expect(servicios[servicio]).toHaveBeenLastCalledWith({ incluirValor: false });
  });
  it('sinValor=1 fuerza incluirValor=false con facturacion:ver y nunca lo aumenta', async () => {
    servicios[servicio].mockResolvedValue({});
    for (const u of ['admin', 'administracion', 'trabajador']) {
      await llamar('GET', `${url}?sinValor=1`, u);
      expect(servicios[servicio], u).toHaveBeenLastCalledWith({ incluirValor: false });
    }
    await llamar('GET', `${url}?categoria=PCB&sinValor=1`, 'admin');
    expect(servicios[servicio]).toHaveBeenLastCalledWith({ categoria: 'PCB', incluirValor: false });
    expect((await llamar('GET', `${url}?sinValor=0`, 'admin')).status).toBe(400);
  });
  it('pasa los filtros validados y rechaza los invalidos con 400', async () => {
    servicios[servicio].mockResolvedValue({});
    const alm = '11111111-1111-4111-8111-111111111111';
    await llamar('GET', `${url}?desde=2026-09-01&hasta=2026-09-30&categoria=PCB&almacen=${alm}&q=bgpp`, 'admin');
    expect(servicios[servicio]).toHaveBeenLastCalledWith({ desde: '2026-09-01', hasta: '2026-09-30', categoria: 'PCB', almacen: alm, q: 'bgpp', incluirValor: true });
    servicios[servicio].mockClear();
    for (const q of ['desde=2026-09-01', 'desde=2026-10-02&hasta=2026-10-01', 'almacen=no-uuid', 'limite=0', 'limite=999999', 'vista=otra', 'categoria=', 'desde=2020-01-01&hasta=2026-10-01']) {
      expect((await llamar('GET', `${url}?${q}`, 'admin')).status, q).toBe(400);
    }
    expect(servicios[servicio]).not.toHaveBeenCalled();
  });
  it('un error interno responde 500 sin filtrar detalles', async () => {
    servicios[servicio].mockRejectedValue(new Error('tabla secreta'));
    const r = await llamar('GET', url, 'trabajador');
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.json)).not.toContain('secreta');
  });
});

describe('el flujo (Sankey) ya no existe', () => {
  it('GET /pantalla/flujo responde 404', async () => {
    expect((await llamar('GET', '/api/inventario/pantalla/flujo', 'admin')).status).toBe(404);
  });
});

describe('/api/inventario/costos', () => {
  const P1 = '44444444-4444-4444-8444-444444444444';
  const P2 = '55555555-5555-4555-8555-555555555555';
  const costos = { productos: [], totales: { valorUsd: null, kgSinCosto: 0, productosSinCosto: 0 } };

  it('GET: solo con facturacion:ver (superadmin y administracion); el trabajador recibe 403 y no se consulta nada', async () => {
    servicios.obtenerCostosInventario.mockResolvedValue(costos);
    for (const u of ['admin', 'administracion']) expect((await llamar('GET', '/api/inventario/costos', u)).json, u).toEqual({ costos });
    expect((await llamar('GET', '/api/inventario/costos', 'trabajador')).status).toBe(403);
    expect((await llamar('GET', '/api/inventario/costos', null)).status).toBe(401);
    expect(servicios.obtenerCostosInventario).toHaveBeenCalledTimes(2);
  });

  it('GET: productos:ver sin facturacion:ver tampoco entra', async () => {
    usuarios.soloKilos = { rol: 'trabajador', permisos: [{ recurso: 'productos', accion: 'ver' }], activo: true };
    expect((await llamar('GET', '/api/inventario/costos', 'soloKilos')).status).toBe(403);
    expect(servicios.obtenerCostosInventario).not.toHaveBeenCalled();
  });

  it('PUT: exige facturacion:editar (ver no basta) y pasa al servicio el actor', async () => {
    servicios.actualizarCostosReferencia.mockResolvedValue({ ok: true, costos, cambiados: 1 });
    usuarios.soloVer = { rol: 'trabajador', permisos: [{ recurso: 'facturacion', accion: 'ver' }], activo: true };
    const cuerpo = { items: [{ productoId: P1, costoReferenciaKg: 1.25 }, { productoId: P2, costoReferenciaKg: null }] };
    expect((await llamar('PUT', '/api/inventario/costos', 'soloVer', cuerpo)).status).toBe(403);
    expect((await llamar('PUT', '/api/inventario/costos', 'trabajador', cuerpo)).status).toBe(403);
    expect(servicios.actualizarCostosReferencia).not.toHaveBeenCalled();
    const ok = await llamar('PUT', '/api/inventario/costos', 'administracion', cuerpo);
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ costos });
    expect(servicios.actualizarCostosReferencia).toHaveBeenCalledWith(cuerpo, { userId: 'administracion', email: 'administracion@x.test' });
  });

  it('PUT: facturacion:editar sin facturacion:ver tampoco entra (la respuesta trae todos los costos)', async () => {
    usuarios.soloEditar = { rol: 'trabajador', permisos: [{ recurso: 'facturacion', accion: 'editar' }], activo: true };
    const cuerpo = { items: [{ productoId: P1, costoReferenciaKg: 1 }] };
    expect((await llamar('PUT', '/api/inventario/costos', 'soloEditar', cuerpo)).status).toBe(403);
    expect(servicios.actualizarCostosReferencia).not.toHaveBeenCalled();
  });

  it('PUT: valida el cuerpo (negativos, tope, repetidos, vacio, mas de 500, ids invalidos) antes de llegar al servicio', async () => {
    const item = (productoId: string, costoReferenciaKg: unknown) => ({ productoId, costoReferenciaKg });
    const muchos = Array.from({ length: 501 }, (_, i) => item(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, 1));
    for (const cuerpo of [
      {}, { items: [] }, { items: muchos }, { items: [item('no-uuid', 1)] }, { items: [item(P1, -1)] }, { items: [item(P1, 1e9)] },
      { items: [item(P1, 'abc')] }, { items: [item(P1, 1), item(P1, 2)] }, { items: [{ productoId: P1 }] },
    ]) {
      expect((await llamar('PUT', '/api/inventario/costos', 'admin', cuerpo)).status, JSON.stringify(cuerpo).slice(0, 60)).toBe(400);
    }
    expect(servicios.actualizarCostosReferencia).not.toHaveBeenCalled();
  });

  it('PUT: acepta 0 (costo valido) y null (quitar la referencia); traduce errores del servicio sin filtrar detalles', async () => {
    servicios.actualizarCostosReferencia.mockResolvedValueOnce({ ok: true, costos, cambiados: 2, advertencia: 'sin auditoria' });
    const r = await llamar('PUT', '/api/inventario/costos', 'admin', { items: [{ productoId: P1, costoReferenciaKg: 0 }, { productoId: P2, costoReferenciaKg: null }] });
    expect(r.json).toEqual({ costos, advertencia: 'sin auditoria' });
    servicios.actualizarCostosReferencia.mockResolvedValueOnce({ ok: false, error: 'Algún producto no existe.', status: 400 });
    expect((await llamar('PUT', '/api/inventario/costos', 'admin', { items: [{ productoId: P1, costoReferenciaKg: 1 }] })).status).toBe(400);
    servicios.actualizarCostosReferencia.mockRejectedValueOnce(new Error('tabla secreta'));
    const e = await llamar('PUT', '/api/inventario/costos', 'admin', { items: [{ productoId: P1, costoReferenciaKg: 1 }] });
    expect(e.status).toBe(500);
    expect(JSON.stringify(e.json)).not.toContain('secreta');
  });
});

describe('GET /api/inventario/pantalla/detalle: parametros propios del detalle', () => {
  it('limite, vista e incluirClasificaciones llegan al servicio', async () => {
    servicios.obtenerDetallePantalla.mockResolvedValue({});
    await llamar('GET', '/api/inventario/pantalla/detalle?limite=50&vista=exportacion&incluirClasificaciones=true', 'trabajador');
    expect(servicios.obtenerDetallePantalla).toHaveBeenLastCalledWith({ limite: 50, vista: 'exportacion', incluirClasificaciones: true, incluirValor: false });
  });
});

describe('precio estimado de los lotes solo con facturacion:ver (/api/lotes)', () => {
  const lote = { id: LOTE, nombre: 'LOTE 1', precioEstimadoKg: 2.5, precioEstimadoActualizadoEn: '2026-10-01T00:00:00Z', precioEstimadoActualizadoPorNombre: 'Julio', stockKg: 100 };
  it('GET: el trabajador no recibe precio, fecha ni autor del precio; superadmin y administracion si', async () => {
    servicios.listarLotes.mockResolvedValue([lote]);
    for (const u of ['admin', 'administracion']) {
      expect((await llamar('GET', '/api/lotes', u)).json, u).toEqual({ lotes: [lote] });
    }
    const r = await llamar('GET', '/api/lotes', 'trabajador');
    expect(r.json).toEqual({ lotes: [{ ...lote, precioEstimadoKg: null, precioEstimadoActualizadoEn: null, precioEstimadoActualizadoPorNombre: null }] });
    expect(JSON.stringify(r.json)).not.toContain('2.5');
  });
  it('PATCH de nombre por el trabajador no devuelve el precio; POST tampoco', async () => {
    servicios.actualizarLote.mockResolvedValue({ lote });
    servicios.crearLote.mockResolvedValue({ lote });
    const patch = await llamar('PATCH', `/api/lotes/${LOTE}`, 'trabajador', { nombre: 'LOTE 9' });
    expect((patch.json as { lote: { precioEstimadoKg: unknown } }).lote.precioEstimadoKg).toBeNull();
    const patchAdmin = await llamar('PATCH', `/api/lotes/${LOTE}`, 'admin', { nombre: 'LOTE 9' });
    expect((patchAdmin.json as { lote: { precioEstimadoKg: unknown } }).lote.precioEstimadoKg).toBe(2.5);
    usuarios.creador = { rol: 'trabajador', permisos: [{ recurso: 'productos', accion: 'ver' }, { recurso: 'productos', accion: 'crear' }], activo: true };
    const post = await llamar('POST', '/api/lotes', 'creador', { nombre: 'LOTE NUEVO' });
    expect(post.status).toBe(201);
    expect((post.json as { lote: { precioEstimadoKg: unknown } }).lote.precioEstimadoKg).toBeNull();
  });
});

describe('/api/inventario/configuracion', () => {
  it('M1: GET con productos:ver; PUT solo superadmin (administracion y trabajador no)', async () => {
    servicios.leerConfiguracionInventario.mockResolvedValue({ metaContenedorKg: 18000 });
    servicios.actualizarConfiguracionInventario.mockResolvedValue({ ok: true, configuracion: { metaContenedorKg: 20000 }, cambios: {} });
    expect((await llamar('GET', '/api/inventario/configuracion', 'administracion')).status).toBe(200);
    expect((await llamar('GET', '/api/inventario/configuracion', 'trabajador')).status).toBe(200);
    for (const u of ['administracion', 'trabajador']) {
      const r = await llamar('PUT', '/api/inventario/configuracion', u, { metaContenedorKg: 20000 });
      expect(r.status, u).toBe(403);
    }
    expect(servicios.actualizarConfiguracionInventario).not.toHaveBeenCalled();
    const ok = await llamar('PUT', '/api/inventario/configuracion', 'admin', { metaContenedorKg: 20000 });
    expect(ok.status).toBe(200);
    expect(servicios.actualizarConfiguracionInventario).toHaveBeenCalledWith({ metaContenedorKg: 20000 }, { userId: 'admin', email: 'admin@x.test' });
  });
  it('M1: una advertencia de auditoria se devuelve al cliente', async () => {
    servicios.actualizarConfiguracionInventario.mockResolvedValue({ ok: true, configuracion: {}, cambios: {}, advertencia: 'no auditada' });
    const r = await llamar('PUT', '/api/inventario/configuracion', 'admin', { metaContenedorKg: 20000 });
    expect(r.json).toMatchObject({ advertencia: 'no auditada' });
  });
  it('valida limites y rechaza claves desconocidas o vacio', async () => {
    for (const cuerpo of [{ metaContenedorKg: 0 }, { metaContenedorKg: 1e9 }, { alertaDiasRoja: 1.5 }, { inventada: 1 }, {}]) {
      expect((await llamar('PUT', '/api/inventario/configuracion', 'admin', cuerpo)).status, JSON.stringify(cuerpo)).toBe(400);
    }
    expect(servicios.actualizarConfiguracionInventario).not.toHaveBeenCalled();
  });
  it('un error de regla entre claves se devuelve con su estado', async () => {
    servicios.actualizarConfiguracionInventario.mockResolvedValue({ ok: false, error: 'roja > amarilla', status: 400 });
    const r = await llamar('PUT', '/api/inventario/configuracion', 'admin', { alertaDiasRoja: 30 });
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ error: 'roja > amarilla' });
  });
});

describe('embalado por kilos (/api/lotes/:id/embalajes)', () => {
  it('cualquier usuario con productos:editar puede embalar, no solo superadmin', async () => {
    servicios.marcarEmbalado.mockResolvedValue({ ok: true, embalaje: { id: EMB, pesoKg: 500 } });
    for (const u of ['admin', 'trabajador']) {
      const r = await llamar('POST', `/api/lotes/${LOTE}/embalajes`, u, { pesoKg: 500 });
      expect(r.status, u).toBe(201);
    }
    expect(servicios.marcarEmbalado).toHaveBeenLastCalledWith(LOTE, expect.objectContaining({ pesoKg: 500 }), { userId: 'trabajador', email: 'trabajador@x.test' });
  });
  it('sin permiso de editar (administracion) o sin sesion: 403 / 401', async () => {
    expect((await llamar('POST', `/api/lotes/${LOTE}/embalajes`, 'administracion', { pesoKg: 5 })).status).toBe(403);
    expect((await llamar('POST', `/api/lotes/${LOTE}/embalajes`, null, { pesoKg: 5 })).status).toBe(401);
    expect(servicios.marcarEmbalado).not.toHaveBeenCalled();
  });
  it('valida el cuerpo antes de llegar al servicio', async () => {
    for (const cuerpo of [{}, { pesoKg: 0 }, { pesoKg: -5 }, { pesoKg: 5, almacenId: 'x' }]) {
      expect((await llamar('POST', `/api/lotes/${LOTE}/embalajes`, 'admin', cuerpo)).status).toBe(400);
    }
    expect(servicios.marcarEmbalado).not.toHaveBeenCalled();
  });
  it('traduce los errores del servicio (kg de mas = 400, lote inexistente = 404, BD sin migrar = 409)', async () => {
    for (const [status, texto] of [[400, 'Solo quedan 40 kg'], [404, 'Lote no encontrado.'], [409, 'no habilitada']] as const) {
      servicios.marcarEmbalado.mockResolvedValueOnce({ ok: false, error: texto, status });
      const r = await llamar('POST', `/api/lotes/${LOTE}/embalajes`, 'trabajador', { pesoKg: 100 });
      expect(r.status).toBe(status);
      expect(r.json).toEqual({ error: texto });
    }
  });
  it('anular exige motivo y permiso de editar', async () => {
    servicios.anularEmbalaje.mockResolvedValue({ ok: true, embalaje: { id: EMB, anulado: true } });
    expect((await llamar('POST', `/api/lotes/${LOTE}/embalajes/${EMB}/anular`, 'trabajador', {})).status).toBe(400);
    expect((await llamar('POST', `/api/lotes/${LOTE}/embalajes/${EMB}/anular`, 'administracion', { motivo: 'error de captura' })).status).toBe(403);
    expect((await llamar('POST', `/api/lotes/${LOTE}/embalajes/${EMB}/anular`, 'trabajador', { motivo: 'error de captura' })).status).toBe(200);
    expect(servicios.anularEmbalaje).toHaveBeenCalledWith(LOTE, EMB, 'error de captura', expect.objectContaining({ userId: 'trabajador' }));
  });
  it('listar con productos:ver', async () => {
    servicios.listarEmbalajes.mockResolvedValue([]);
    expect((await llamar('GET', `/api/lotes/${LOTE}/embalajes?incluirAnulados=true`, 'administracion')).status).toBe(200);
    expect(servicios.listarEmbalajes).toHaveBeenCalledWith(LOTE, { incluirAnulados: true });
  });
});

describe('PATCH /api/lotes/:id (clase y precio estimado)', () => {
  it('M1: clase y precio estimado solo los cambia un superadmin, que pasa su actor al servicio para la auditoria', async () => {
    servicios.actualizarLote.mockResolvedValue({ lote: { id: LOTE } });
    const r = await llamar('PATCH', `/api/lotes/${LOTE}`, 'admin', { clase: 'exportacion', precioEstimadoKg: 1.8 });
    expect(r.status).toBe(200);
    expect(servicios.actualizarLote).toHaveBeenCalledWith(LOTE, { clase: 'exportacion', precioEstimadoKg: 1.8 }, { userId: 'admin', email: 'admin@x.test' });
  });
  it('M1: el trabajador (productos:editar) NO puede cambiar clase ni precio, ni solos ni mezclados con otros campos', async () => {
    for (const cuerpo of [{ clase: 'trabajo' }, { precioEstimadoKg: 2 }, { precioEstimadoKg: null }, { nombre: 'X', clase: 'otro' }]) {
      const r = await llamar('PATCH', `/api/lotes/${LOTE}`, 'trabajador', cuerpo);
      expect(r.status, JSON.stringify(cuerpo)).toBe(403);
      expect(String(r.json?.error)).toMatch(/superadmin/i);
    }
    expect((await llamar('PATCH', `/api/lotes/${LOTE}`, 'administracion', { clase: 'trabajo' })).status).toBe(403);
    expect(servicios.actualizarLote).not.toHaveBeenCalled();
  });
  it('M1: el trabajador sigue pudiendo editar nombre y fotos (no son clasificacion)', async () => {
    servicios.actualizarLote.mockResolvedValue({ lote: { id: LOTE } });
    expect((await llamar('PATCH', `/api/lotes/${LOTE}`, 'trabajador', { nombre: 'LOTE 9' })).status).toBe(200);
    expect(servicios.actualizarLote).toHaveBeenCalledWith(LOTE, { nombre: 'LOTE 9' }, expect.objectContaining({ userId: 'trabajador' }));
  });
  it('un PATCH que no menciona las fotos no las manda (no las borra)', async () => {
    servicios.actualizarLote.mockResolvedValue({ lote: { id: LOTE } });
    await llamar('PATCH', `/api/lotes/${LOTE}`, 'admin', { precioEstimadoKg: null });
    expect(servicios.actualizarLote.mock.calls[0][1]).toEqual({ precioEstimadoKg: null });
    expect(servicios.actualizarLote.mock.calls[0][1]).not.toHaveProperty('fotos');
  });
  it('rechaza clase invalida y precio negativo', async () => {
    expect((await llamar('PATCH', `/api/lotes/${LOTE}`, 'admin', { clase: 'x' })).status).toBe(400);
    expect((await llamar('PATCH', `/api/lotes/${LOTE}`, 'admin', { precioEstimadoKg: -1 })).status).toBe(400);
  });
  it('BD sin migrar responde 409', async () => {
    servicios.actualizarLote.mockResolvedValue({ error: 'no habilitada' });
    expect((await llamar('PATCH', `/api/lotes/${LOTE}`, 'admin', { clase: 'trabajo' })).status).toBe(409);
  });
});

describe('M5: validacion de ids y errores', () => {
  it('un id de lote que no es uuid responde 400 con mensaje claro, sin tocar el servicio', async () => {
    const rutas: Array<[string, string, unknown?]> = [
      ['PATCH', '/api/lotes/no-es-uuid', { nombre: 'X' }],
      ['GET', '/api/lotes/123/embalajes'],
      ['POST', '/api/lotes/abc/embalajes', { pesoKg: 5 }],
      ['POST', `/api/lotes/abc/embalajes/${EMB}/anular`, { motivo: 'error de captura' }],
      ['POST', `/api/lotes/${LOTE}/embalajes/xyz/anular`, { motivo: 'error de captura' }],
    ];
    for (const [m, ruta, cuerpo] of rutas) {
      const r = await llamar(m, ruta, 'admin', cuerpo);
      expect(r.status, ruta).toBe(400);
      expect(String(r.json?.error), ruta).toMatch(/no es válido/);
    }
    for (const f of [servicios.actualizarLote, servicios.listarEmbalajes, servicios.marcarEmbalado, servicios.anularEmbalaje]) {
      expect(f).not.toHaveBeenCalled();
    }
  });
  it('los errores de lectura responden 500 con texto propio, sin filtrar el detalle', async () => {
    servicios.listarLotes.mockRejectedValue(new Error('relation lote_embalajes tabla secreta'));
    servicios.listarEmbalajes.mockRejectedValue(new Error('tabla secreta'));
    for (const ruta of ['/api/lotes', `/api/lotes/${LOTE}/embalajes`]) {
      const r = await llamar('GET', ruta, 'trabajador');
      expect(r.status, ruta).toBe(500);
      expect(JSON.stringify(r.json)).not.toContain('secreta');
    }
  });
  it('M1: embalar y anular devuelven la advertencia cuando la auditoria no se pudo registrar', async () => {
    servicios.marcarEmbalado.mockResolvedValue({ ok: true, embalaje: { id: EMB, pesoKg: 5 }, advertencia: 'sin historial' });
    servicios.anularEmbalaje.mockResolvedValue({ ok: true, embalaje: { id: EMB }, advertencia: 'sin historial' });
    const a = await llamar('POST', `/api/lotes/${LOTE}/embalajes`, 'trabajador', { pesoKg: 5 });
    expect(a.status).toBe(201);
    expect(a.json).toMatchObject({ advertencia: 'sin historial' });
    const b = await llamar('POST', `/api/lotes/${LOTE}/embalajes/${EMB}/anular`, 'trabajador', { motivo: 'error de captura' });
    expect(b.json).toMatchObject({ advertencia: 'sin historial' });
  });
});

describe('PATCH /api/transformaciones/:id/merma', () => {
  const cuerpo = { detalle: [{ tipo: 'basura', pesoKg: 1.5 }] };
  it('con permiso transformaciones:editar (solo superadmin) pasa; trabajador sin llave no', async () => {
    servicios.editarMermaTransformacion.mockResolvedValue({ ok: true, desglose: { kgSinClasificar: 0 } });
    expect((await llamar('PATCH', `/api/transformaciones/${TRANS}/merma`, 'admin', cuerpo)).status).toBe(200);
    expect((await llamar('PATCH', `/api/transformaciones/${TRANS}/merma`, 'trabajador', cuerpo)).status).toBe(403);
  });
  it('con llave de edicion el trabajador llega al servicio, que valida la llave', async () => {
    servicios.editarMermaTransformacion.mockResolvedValue({ ok: false, error: 'Llave inválida.', codigo: 403 });
    const r = await llamar('PATCH', `/api/transformaciones/${TRANS}/merma`, 'trabajador', { ...cuerpo, llaveEdicion: 'ABCDE-12345' });
    expect(r.status).toBe(403);
    expect(servicios.editarMermaTransformacion).toHaveBeenCalledWith(
      TRANS, cuerpo.detalle, expect.objectContaining({ userId: 'trabajador', llave: 'ABCDE-12345' })
    );
  });
  it('valida tipos y pesos', async () => {
    for (const detalle of [[{ tipo: 'vidrio', pesoKg: 1 }], [{ tipo: 'otro', pesoKg: 0 }], 'x']) {
      expect((await llamar('PATCH', `/api/transformaciones/${TRANS}/merma`, 'admin', { detalle })).status).toBe(400);
    }
  });
});
