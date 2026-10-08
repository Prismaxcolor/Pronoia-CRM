import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Cableado de rutas con acceso por banca y datos de valor, a través de los routers reales:
 * /usuarios/:id/bancas, GET cochinito/movimientos/:id, telegramChatId de bancas y packing list.
 * Los servicios son dobles; aquí solo se prueba autorización y mapeo de estados HTTP.
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

const s = vi.hoisted(() => ({
  listarBancasDeUsuario: vi.fn(),
  reemplazarBancasDeUsuario: vi.fn(),
  bancasPermitidas: vi.fn(),
  concederBancaAUsuario: vi.fn(),
  obtenerDetalleMovimiento: vi.fn(),
  crearBanca: vi.fn(),
  actualizarBanca: vi.fn(),
  archivarBanca: vi.fn(),
  leerTelegramChatIdBanca: vi.fn(),
  obtenerPackingList: vi.fn(),
}));

vi.mock('../src/services/banca-acceso-service.js', () => ({
  listarBancasDeUsuario: s.listarBancasDeUsuario,
  reemplazarBancasDeUsuario: s.reemplazarBancasDeUsuario,
  bancasPermitidas: s.bancasPermitidas,
  concederBancaAUsuario: s.concederBancaAUsuario,
  idsBancasDeMovimiento: vi.fn(async () => []),
  idsBancasDeGrupo: vi.fn(async () => []),
}));
vi.mock('../src/services/edicion-autorizada-service.js', () => ({
  esSuperadminEnBd: async (id: string) => usuarios[id]?.rol === 'superadmin' && usuarios[id]?.activo === true,
  obtenerUsuarioVigente: async (id: string) => (usuarios[id] ? { rol: usuarios[id].rol, activo: usuarios[id].activo } : null),
}));
vi.mock('../src/services/banca-service.js', () => ({
  listarBancas: vi.fn(async () => []),
  listarMovimientos: vi.fn(async () => []),
  crearBanca: s.crearBanca,
  actualizarBanca: s.actualizarBanca,
  archivarBanca: s.archivarBanca,
  desarchivarBanca: vi.fn(),
  crearMovimiento: vi.fn(),
  obtenerDetalleMovimiento: s.obtenerDetalleMovimiento,
  leerTelegramChatIdBanca: s.leerTelegramChatIdBanca,
}));
vi.mock('../src/services/movimiento-edicion-service.js', () => ({ anularMovimientoBanca: vi.fn(), editarMovimientoBanca: vi.fn() }));
vi.mock('../src/services/usuario-service.js', () => ({
  listarUsuarios: vi.fn(), crearUsuarioAdmin: vi.fn(), actualizarUsuarioAdmin: vi.fn(),
  desactivarUsuario: vi.fn(), reactivarUsuario: vi.fn(), borrarUsuario: vi.fn(),
}));
vi.mock('../src/services/usuario-telegram-service.js', () => ({
  generarLinkTelegramUsuario: vi.fn(), desvincularTelegramUsuario: vi.fn(), puedeGestionarTelegramDe: vi.fn(() => true),
}));
vi.mock('../src/services/packing-list-service.js', () => ({
  eliminarPackingList: vi.fn(), guardarEmpresa: vi.fn(), guardarPackingList: vi.fn(), listarPackingLists: vi.fn(),
  obtenerEmpresas: vi.fn(), obtenerPackingList: s.obtenerPackingList, MENSAJE_PACKING_NO_LEIDO: 'no leido',
}));
vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  clienteIp: () => '127.0.0.1',
}));

const { default: usuariosRouter } = await import('../src/routes/usuarios.js');
const { default: cochinitoRouter } = await import('../src/routes/cochinito.js');
const { default: packingRouter } = await import('../src/routes/packing-lists.js');
const { logger } = await import('../src/utils/logger.js');

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const MOV = '33333333-3333-4333-8333-333333333333';
const BANCA = '44444444-4444-4444-8444-444444444444';
const permisos = (...pares: Array<[string, string]>): Perm[] => pares.map(([recurso, accion]) => ({ recurso, accion }));

let servidor: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/usuarios', usuariosRouter);
  app.use('/api/cochinito', cochinitoRouter);
  app.use('/api/packing-lists', packingRouter);
  await new Promise<void>(resolve => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => { servidor.close(); });

beforeEach(() => {
  for (const k of Object.keys(usuarios)) delete usuarios[k];
  const gestionBancas = permisos(['usuarios', 'ver'], ['usuarios', 'editar'], ['cochinito', 'ver'], ['cochinito', 'crear'], ['cochinito', 'editar']);
  usuarios.root = { rol: 'superadmin', permisos: null, activo: true };
  usuarios.gestor = { rol: 'administracion', permisos: gestionBancas, activo: true };
  usuarios[ID_A] = { rol: 'trabajador', permisos: null, activo: true };
  usuarios.cajero = { rol: 'trabajador', permisos: gestionBancas, activo: true };
  usuarios.sinFactura = { rol: 'trabajador', permisos: permisos(['despachos', 'ver']), activo: true };
  usuarios.conFactura = { rol: 'trabajador', permisos: permisos(['despachos', 'ver'], ['facturacion', 'ver']), activo: true };
  for (const f of Object.values(s)) f.mockReset();
  vi.mocked(logger.info).mockClear();
  s.bancasPermitidas.mockResolvedValue(null);
  s.concederBancaAUsuario.mockResolvedValue({ ok: true });
  s.leerTelegramChatIdBanca.mockResolvedValue(null);
});

async function llamar(metodo: string, ruta: string, usuario: string | null, body?: unknown) {
  const res = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(usuario ? { Authorization: `Bearer ${usuario}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

describe('GET/PUT /api/usuarios/:id/bancas', () => {
  it('sin sesión: 401', async () => {
    expect((await llamar('GET', `/api/usuarios/${ID_A}/bancas`, null)).status).toBe(401);
  });

  it('GET: superadmin lee las cuentas de un trabajador', async () => {
    s.listarBancasDeUsuario.mockResolvedValue([BANCA]);
    const r = await llamar('GET', `/api/usuarios/${ID_A}/bancas`, 'root');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ bancaIds: [BANCA] });
  });

  it('GET: administracion (aun con usuarios:ver) recibe 403', async () => {
    const r = await llamar('GET', `/api/usuarios/${ID_A}/bancas`, 'gestor');
    expect(r.status).toBe(403);
    expect(s.listarBancasDeUsuario).not.toHaveBeenCalled();
  });

  it('PUT: administracion (aun con usuarios:editar) recibe 403', async () => {
    const r = await llamar('PUT', `/api/usuarios/${ID_A}/bancas`, 'gestor', { bancaIds: [BANCA] });
    expect(r.status).toBe(403);
    expect(s.reemplazarBancasDeUsuario).not.toHaveBeenCalled();
  });

  it('GET: migración pendiente => 409', async () => {
    s.listarBancasDeUsuario.mockResolvedValue({ error: 'falta migración' });
    expect((await llamar('GET', `/api/usuarios/${ID_A}/bancas`, 'root')).status).toBe(409);
  });

  it('PUT: reemplaza y responde ok', async () => {
    s.reemplazarBancasDeUsuario.mockResolvedValue({ ok: true });
    const r = await llamar('PUT', `/api/usuarios/${ID_A}/bancas`, 'root', { bancaIds: [BANCA] });
    expect(r.status).toBe(200);
    expect(s.reemplazarBancasDeUsuario).toHaveBeenCalledWith(ID_A, [BANCA]);
  });

  it('PUT: id inválido en el body => 400', async () => {
    expect((await llamar('PUT', `/api/usuarios/${ID_A}/bancas`, 'root', { bancaIds: ['x'] })).status).toBe(400);
  });

  it('PUT: quien no es superadmin no puede editar sus propias cuentas', async () => {
    usuarios[ID_B] = { rol: 'administracion', permisos: permisos(['usuarios', 'editar']), activo: true };
    const r = await llamar('PUT', `/api/usuarios/${ID_B}/bancas`, ID_B, { bancaIds: [BANCA] });
    expect(r.status).toBe(403);
    expect(s.reemplazarBancasDeUsuario).not.toHaveBeenCalled();
  });

  it('PUT/GET: un no-superadmin no gestiona las cuentas de un superadmin', async () => {
    usuarios[ID_B] = { rol: 'superadmin', permisos: null, activo: true };
    expect((await llamar('PUT', `/api/usuarios/${ID_B}/bancas`, 'gestor', { bancaIds: [] })).status).toBe(403);
    expect((await llamar('GET', `/api/usuarios/${ID_B}/bancas`, 'gestor')).status).toBe(403);
    expect(s.reemplazarBancasDeUsuario).not.toHaveBeenCalled();
  });

  it('PUT: un superadmin sí puede asignarse a sí mismo o a otro superadmin', async () => {
    s.reemplazarBancasDeUsuario.mockResolvedValue({ ok: true });
    usuarios[ID_B] = { rol: 'superadmin', permisos: null, activo: true };
    expect((await llamar('PUT', `/api/usuarios/${ID_B}/bancas`, ID_B, { bancaIds: [] })).status).toBe(200);
    expect((await llamar('PUT', `/api/usuarios/${ID_B}/bancas`, 'root', { bancaIds: [] })).status).toBe(200);
  });

  it('PUT: falla de BD => 500 con mensaje genérico; migración pendiente => 409', async () => {
    s.reemplazarBancasDeUsuario.mockResolvedValueOnce({ error: 'No se pudieron guardar' });
    const falla = await llamar('PUT', `/api/usuarios/${ID_A}/bancas`, 'root', { bancaIds: [] });
    expect(falla.status).toBe(500);
    expect(falla.json).toEqual({ error: 'No se pudieron guardar' });
    s.reemplazarBancasDeUsuario.mockResolvedValueOnce({ error: 'pendiente', pendiente: true });
    expect((await llamar('PUT', `/api/usuarios/${ID_A}/bancas`, 'root', { bancaIds: [] })).status).toBe(409);
  });
});

describe('GET /api/cochinito/movimientos/:id', () => {
  const detalle = (origen: string, destino: string | null) => ({ movimiento: { id: MOV, bancaOrigenId: origen, bancaDestinoId: destino } });

  it('403 si no tiene acceso ni al origen ni al destino', async () => {
    s.obtenerDetalleMovimiento.mockResolvedValue(detalle('x', 'y'));
    s.bancasPermitidas.mockResolvedValue(new Set(['otra']));
    expect((await llamar('GET', `/api/cochinito/movimientos/${MOV}`, 'cajero')).status).toBe(403);
  });

  it('200 si tiene acceso al destino aunque no al origen', async () => {
    s.obtenerDetalleMovimiento.mockResolvedValue(detalle('x', 'y'));
    s.bancasPermitidas.mockResolvedValue(new Set(['y']));
    expect((await llamar('GET', `/api/cochinito/movimientos/${MOV}`, 'cajero')).status).toBe(200);
  });

  it('404 si el movimiento no existe', async () => {
    s.obtenerDetalleMovimiento.mockResolvedValue(null);
    expect((await llamar('GET', `/api/cochinito/movimientos/${MOV}`, 'cajero')).status).toBe(404);
  });
});

describe('POST/PATCH /api/cochinito/bancas: grupo de Telegram y acceso del creador', () => {
  const nueva = { nombre: 'BNC', tipo: 'banco_nacional', moneda: 'USD', descripcion: '' };

  it('un trabajador no puede fijar el grupo de Telegram al crear (403)', async () => {
    const r = await llamar('POST', '/api/cochinito/bancas', 'cajero', { ...nueva, telegramChatId: '-1001234567890' });
    expect(r.status).toBe(403);
    expect(s.crearBanca).not.toHaveBeenCalled();
  });

  it('administración no puede cambiar el grupo de Telegram (403) ni fijarlo al crear', async () => {
    s.leerTelegramChatIdBanca.mockResolvedValue('-100111111');
    s.bancasPermitidas.mockResolvedValue(new Set([BANCA]));
    expect((await llamar('PATCH', `/api/cochinito/bancas/${BANCA}`, 'gestor', { telegramChatId: '-100222222' })).status).toBe(403);
    expect((await llamar('POST', '/api/cochinito/bancas', 'gestor', { ...nueva, telegramChatId: '-1001234567890' })).status).toBe(403);
    expect(s.actualizarBanca).not.toHaveBeenCalled();
    expect(s.crearBanca).not.toHaveBeenCalled();
  });

  it('superadmin sí puede fijar el grupo al editar y se registra el valor anterior', async () => {
    s.leerTelegramChatIdBanca.mockResolvedValue('-100111111');
    s.actualizarBanca.mockResolvedValue({ banca: { id: BANCA } });
    const r = await llamar('PATCH', `/api/cochinito/bancas/${BANCA}`, 'root', { telegramChatId: '-100222222' });
    expect(r.status).toBe(200);
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ evento: 'banca_telegram_chat_modificado', anterior: '-100111111', nuevo: '-100222222' }));
  });

  it('un trabajador no puede cambiar el grupo de una cuenta (403), pero sí editar sin cambiarlo', async () => {
    s.leerTelegramChatIdBanca.mockResolvedValue('-100111111');
    s.actualizarBanca.mockResolvedValue({ banca: { id: BANCA } });
    s.bancasPermitidas.mockResolvedValue(new Set([BANCA]));
    expect((await llamar('PATCH', `/api/cochinito/bancas/${BANCA}`, 'cajero', { telegramChatId: '-100999999' })).status).toBe(403);
    expect((await llamar('PATCH', `/api/cochinito/bancas/${BANCA}`, 'cajero', { telegramChatId: '-100111111', nombre: 'X' })).status).toBe(200);
  });

  it('editar con grupo y sin migración => 409', async () => {
    s.actualizarBanca.mockResolvedValue({ error: 'migración pendiente', pendiente: true });
    expect((await llamar('PATCH', `/api/cochinito/bancas/${BANCA}`, 'root', { telegramChatId: '-100999999' })).status).toBe(409);
  });

  it('si no se pudo conceder el acceso al creador (trabajador), no hay 201: se archiva y devuelve 500', async () => {
    s.crearBanca.mockResolvedValue({ banca: { id: BANCA } });
    s.concederBancaAUsuario.mockResolvedValue({ error: 'fk' });
    s.archivarBanca.mockResolvedValue({ ok: true });
    const r = await llamar('POST', '/api/cochinito/bancas', 'cajero', nueva);
    expect(r.status).toBe(500);
    expect(s.archivarBanca).toHaveBeenCalledWith(BANCA);
  });

  it('un superadmin crea la cuenta aunque falle la concesión (ve todas igual)', async () => {
    s.crearBanca.mockResolvedValue({ banca: { id: BANCA } });
    s.concederBancaAUsuario.mockResolvedValue({ error: 'fk' });
    expect((await llamar('POST', '/api/cochinito/bancas', 'root', nueva)).status).toBe(201);
  });

  it('administración que crea una cuenta sin lograr concederle acceso: se archiva y 500', async () => {
    s.crearBanca.mockResolvedValue({ banca: { id: BANCA } });
    s.concederBancaAUsuario.mockResolvedValue({ error: 'fk' });
    s.archivarBanca.mockResolvedValue({ ok: true });
    expect((await llamar('POST', '/api/cochinito/bancas', 'gestor', nueva)).status).toBe(500);
    expect(s.archivarBanca).toHaveBeenCalledWith(BANCA);
  });
});

describe('GET /api/packing-lists/:id: proyección solo con facturacion:ver', () => {
  it('sin facturacion:ver se pide sin valores; con ella, con valores', async () => {
    s.obtenerPackingList.mockResolvedValue({ id: ID_A });
    await llamar('GET', `/api/packing-lists/${ID_A}`, 'sinFactura');
    expect(s.obtenerPackingList).toHaveBeenLastCalledWith(ID_A, { puedeVerValores: false });
    await llamar('GET', `/api/packing-lists/${ID_A}`, 'conFactura');
    expect(s.obtenerPackingList).toHaveBeenLastCalledWith(ID_A, { puedeVerValores: true });
  });
});
