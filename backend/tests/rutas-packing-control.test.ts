import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Cableado de /api/packing-lists: el almacén, las fotos y los kg disponibles (control interno) solo salen con permiso de
 * inventario (productos:ver) o facturacion:ver; la subida de fotos exige lo mismo, valida el tipo y tiene límite por usuario.
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

const s = vi.hoisted(() => ({
  obtenerPackingList: vi.fn(),
  listarOpcionesLotePacking: vi.fn(),
  subirFotoPacking: vi.fn(),
}));
vi.mock('../src/services/packing-list-service.js', () => ({
  eliminarPackingList: vi.fn(), guardarEmpresa: vi.fn(), guardarPackingList: vi.fn(), listarPackingLists: vi.fn(),
  obtenerEmpresas: vi.fn(), obtenerPackingList: s.obtenerPackingList, MENSAJE_PACKING_NO_LEIDO: 'no leído',
}));
vi.mock('../src/services/packing-list-lotes-service.js', () => ({
  listarOpcionesLotePacking: s.listarOpcionesLotePacking, MENSAJE_LOTES_PACKING_NO_LEIDOS: 'no leídos',
}));
vi.mock('../src/services/packing-list-fotos-service.js', () => ({ subirFotoPacking: s.subirFotoPacking }));
vi.mock('../src/services/operaciones-idempotentes-cola.js', () => ({
  cuerpoConRepetida: vi.fn(), ejecutarOperacion: vi.fn(), tipoDeRecurso: vi.fn(), TIPO_OPERACION: {},
}));
vi.mock('../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  clienteIp: () => '127.0.0.1',
}));

const { default: router } = await import('../src/routes/packing-lists.js');

const ID = '11111111-1111-4111-8111-111111111111';
const permisos = (...pares: Array<[string, string]>): Perm[] => pares.map(([recurso, accion]) => ({ recurso, accion }));
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

let servidor: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/packing-lists', router);
  await new Promise<void>(resolve => { servidor = app.listen(0, resolve); });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => { servidor.close(); });

beforeEach(() => {
  for (const k of Object.keys(usuarios)) delete usuarios[k];
  usuarios.root = { rol: 'superadmin', permisos: null, activo: true };
  // Solo despachos: arma packing lists pero no ve inventario ni facturación.
  usuarios.despachador = { rol: 'trabajador', permisos: permisos(['despachos', 'ver'], ['despachos', 'crear'], ['despachos', 'editar']), activo: true };
  usuarios.inventarista = {
    rol: 'trabajador', permisos: permisos(['despachos', 'ver'], ['despachos', 'crear'], ['productos', 'ver']), activo: true,
  };
  usuarios.facturador = { rol: 'trabajador', permisos: permisos(['despachos', 'ver'], ['facturacion', 'ver']), activo: true };
  for (const f of Object.values(s)) f.mockReset();
  s.obtenerPackingList.mockResolvedValue({ id: ID, items: [] });
  s.listarOpcionesLotePacking.mockResolvedValue([]);
  s.subirFotoPacking.mockResolvedValue({ ok: true, ruta: 'pl/x.jpg' });
});

const get = (ruta: string, token: string) =>
  fetch(`${base}/api/packing-lists${ruta}`, { headers: { Authorization: `Bearer ${token}` } });

function subir(token: string, archivo: Buffer, mime: string, extra: Record<string, string> = {}) {
  const f = new FormData();
  f.append('file', new Blob([new Uint8Array(archivo)], { type: mime }), 'foto.jpg');
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return fetch(`${base}/api/packing-lists/fotos`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: f });
}

describe('GET /:id', () => {
  it.each([
    ['despachador', false], ['inventarista', true], ['facturador', true], ['root', true],
  ])('%s: puedeVerControl=%s', async (token, esperado) => {
    const r = await get(`/${ID}`, token);
    expect(r.status).toBe(200);
    expect(s.obtenerPackingList.mock.calls[0][1]).toMatchObject({ puedeVerControl: esperado });
  });
});

describe('GET /lotes-exportacion', () => {
  it.each([
    ['despachador', false], ['inventarista', true], ['facturador', true],
  ])('%s: puedeVerDisponible=%s', async (token, esperado) => {
    const r = await get('/lotes-exportacion', token);
    expect(r.status).toBe(200);
    expect(s.listarOpcionesLotePacking).toHaveBeenCalledWith({ puedeVerDisponible: esperado });
  });
});

describe('POST /fotos', () => {
  it('sin permiso de inventario responde 403 y no sube nada', async () => {
    const r = await subir('despachador', JPG, 'image/jpeg');
    expect(r.status).toBe(403);
    expect(s.subirFotoPacking).not.toHaveBeenCalled();
  });

  it('con permiso y tipo coherente sube la foto', async () => {
    const r = await subir('inventarista', JPG, 'image/jpeg');
    expect(r.status).toBe(201);
    expect(s.subirFotoPacking).toHaveBeenCalledTimes(1);
  });

  it('rechaza un tipo declarado que no coincide con la firma', async () => {
    const r = await subir('inventarista', JPG, 'image/png');
    expect(r.status).toBe(400);
    expect(s.subirFotoPacking).not.toHaveBeenCalled();
  });

  it('rechaza campos de texto extra en el multipart (límites de multer)', async () => {
    const r = await subir('inventarista', JPG, 'image/jpeg', { x: '1' });
    expect(r.status).toBe(400);
    expect(s.subirFotoPacking).not.toHaveBeenCalled();
  });
});

describe('POST /fotos: límite por usuario', () => {
  it('después de LIMITE_FOTOS_PACKING_POR_MINUTO subidas responde 429 solo a ese usuario', async () => {
    const { LIMITE_FOTOS_PACKING_POR_MINUTO } = await import('../src/middlewares/rate-limit.js');
    let ultimo = 0;
    for (let i = 0; i < LIMITE_FOTOS_PACKING_POR_MINUTO + 1; i++) ultimo = (await subir('inventarista', JPG, 'image/jpeg')).status;
    expect(ultimo).toBe(429);
    expect((await subir('root', JPG, 'image/jpeg')).status).toBe(201);
  });
});
