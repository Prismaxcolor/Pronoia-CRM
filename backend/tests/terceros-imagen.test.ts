import { describe, it, expect, vi, beforeEach } from 'vitest';

// Los esquemas validan URLs contra ENV.SUPABASE_URL: se fija para no depender del .env local.
vi.mock('../src/config/env.js', async importOriginal => {
  const real = await importOriginal<typeof import('../src/config/env.js')>();
  return { ...real, ENV: { ...real.ENV, SUPABASE_URL: 'https://p.supabase.test' } };
});

type Resp = { data: Record<string, unknown> | null; error: { code?: string; message: string } | null };
const bd = vi.hoisted(() => ({ respuestas: [] as unknown[], actualizaciones: [] as Array<Record<string, unknown>>, altas: [] as Array<Record<string, unknown>> }));

vi.mock('../src/config/supabase.js', () => {
  const cadena = (valores: Record<string, unknown>) => {
    bd.actualizaciones.push(valores);
    const c: Record<string, unknown> = {};
    for (const m of ['eq', 'select']) c[m] = () => c;
    c.maybeSingle = () => Promise.resolve(bd.respuestas.shift() as Resp);
    return c;
  };
  return { supabaseAdmin: { from: () => ({ update: cadena }) } };
});

vi.mock('../src/services/insertar-idempotente.js', () => ({
  insertarMaestroIdempotente: vi.fn(async (_tabla: string, valores: Record<string, unknown>) => {
    bd.altas.push(valores);
    return bd.respuestas.shift() as Resp;
  }),
}));

import { crearProveedorSchema, actualizarProveedorSchema } from '../src/schemas/proveedores.js';
import { crearClienteSchema, actualizarClienteSchema } from '../src/schemas/clientes.js';
import { actualizarProveedor, crearProveedor } from '../src/services/proveedor-service.js';
import { actualizarCliente, crearCliente } from '../src/services/cliente-service.js';

const HOST = 'https://p.supabase.test/storage/v1/object/public';
const IMG_PROV = `${HOST}/proveedores/3f2b1c9e-5a4d-4e0a-9b7a-0c1d2e3f4a5b.png`;
const IMG_CLI = `${HOST}/clientes/3f2b1c9e-5a4d-4e0a-9b7a-0c1d2e3f4a5b.webp`;
const columnaFalta = { code: '42703', message: 'column "imagen_url" of relation "x" does not exist' };
const filaProv = { id: 'p1', nombre: 'Acme', rfc: null, telefono: null, email: null, activo: true, created_at: '2026-10-01', fotos: [], telegram_chat_id: null, telegram_linked_at: null };
const filaCli = { id: 'c1', nombre: 'Beta', identificacion: null, email: null, telefono: null, direccion: null, notas: null, activo: true, creado_por: 'u', creado_en: '2026-10-01', fotos: [], telegram_chat_id: null, telegram_linked_at: null, tipo_venta: 'nacional' };

beforeEach(() => { bd.respuestas = []; bd.actualizaciones = []; bd.altas = []; });

describe('imagenUrl en los esquemas de proveedor y cliente', () => {
  it('es opcional: sin el campo no aparece (un PATCH sin ella no la toca)', () => {
    expect(crearProveedorSchema.parse({ nombre: 'Acme' }).imagenUrl).toBeUndefined();
    expect(actualizarProveedorSchema.parse({ nombre: 'Acme' })).not.toHaveProperty('imagenUrl');
    expect(actualizarClienteSchema.parse({ nombre: 'Beta' })).not.toHaveProperty('imagenUrl');
  });
  it('acepta una imagen del bucket propio y null para quitarla', () => {
    expect(crearProveedorSchema.parse({ nombre: 'Acme', imagenUrl: IMG_PROV }).imagenUrl).toBe(IMG_PROV);
    expect(crearClienteSchema.parse({ nombre: 'Beta', imagenUrl: IMG_CLI }).imagenUrl).toBe(IMG_CLI);
    expect(actualizarProveedorSchema.parse({ imagenUrl: null }).imagenUrl).toBeNull();
    expect(actualizarClienteSchema.parse({ imagenUrl: null }).imagenUrl).toBeNull();
  });
  it('rechaza URLs de otro bucket, de otro host, SVG o texto que no es URL', () => {
    expect(crearProveedorSchema.safeParse({ nombre: 'A', imagenUrl: IMG_CLI }).success).toBe(false);
    expect(crearClienteSchema.safeParse({ nombre: 'B', imagenUrl: IMG_PROV }).success).toBe(false);
    expect(crearProveedorSchema.safeParse({ nombre: 'A', imagenUrl: IMG_PROV.replace('p.supabase.test', 'evil.test') }).success).toBe(false);
    expect(crearProveedorSchema.safeParse({ nombre: 'A', imagenUrl: IMG_PROV.replace('.png', '.svg') }).success).toBe(false);
    expect(crearClienteSchema.safeParse({ nombre: 'B', imagenUrl: 'no-es-url' }).success).toBe(false);
  });
});

describe('servicios de proveedor y cliente con imagen', () => {
  it('alta: solo manda imagen_url si viene (sin imagen no depende de la columna)', async () => {
    bd.respuestas = [{ data: filaProv, error: null }, { data: { ...filaProv, imagen_url: IMG_PROV }, error: null }];
    await crearProveedor(crearProveedorSchema.parse({ nombre: 'Acme' }));
    expect(bd.altas[0]).not.toHaveProperty('imagen_url');
    const r = await crearProveedor(crearProveedorSchema.parse({ nombre: 'Acme', imagenUrl: IMG_PROV }));
    expect(bd.altas[1].imagen_url).toBe(IMG_PROV);
    expect(r).toMatchObject({ proveedor: { imagenUrl: IMG_PROV } });
  });
  it('alta de cliente con imagen; sin la migración responde con el aviso, no con el error crudo', async () => {
    bd.respuestas = [{ data: { ...filaCli, imagen_url: IMG_CLI }, error: null }, { data: null, error: columnaFalta }];
    const ok = await crearCliente(crearClienteSchema.parse({ nombre: 'Beta', imagenUrl: IMG_CLI }), 'u');
    expect(bd.altas[0].imagen_url).toBe(IMG_CLI);
    expect(ok).toMatchObject({ cliente: { imagenUrl: IMG_CLI } });
    const mal = await crearCliente(crearClienteSchema.parse({ nombre: 'Beta', imagenUrl: IMG_CLI }), 'u');
    expect(mal).toMatchObject({ error: expect.stringContaining('migration_terceros_imagen.sql') });
  });
  it('edición: imagenUrl omitido no toca la columna; null la quita; texto la cambia', async () => {
    bd.respuestas = [{ data: filaProv, error: null }, { data: filaProv, error: null }, { data: { ...filaProv, imagen_url: IMG_PROV }, error: null }];
    await actualizarProveedor('p1', actualizarProveedorSchema.parse({ nombre: 'Nuevo' }));
    expect(bd.actualizaciones[0]).not.toHaveProperty('imagen_url');
    await actualizarProveedor('p1', actualizarProveedorSchema.parse({ imagenUrl: null }));
    expect(bd.actualizaciones[1]).toEqual({ imagen_url: null });
    const r = await actualizarProveedor('p1', actualizarProveedorSchema.parse({ imagenUrl: IMG_PROV }));
    expect(r).toMatchObject({ proveedor: { imagenUrl: IMG_PROV } });
  });
  it('edición sin la migración: pendiente (409), no un 500 con el error de la base', async () => {
    bd.respuestas = [{ data: null, error: columnaFalta }, { data: null, error: columnaFalta }];
    expect(await actualizarProveedor('p1', actualizarProveedorSchema.parse({ imagenUrl: IMG_PROV }))).toMatchObject({ pendiente: true });
    expect(await actualizarCliente('c1', actualizarClienteSchema.parse({ imagenUrl: IMG_CLI }))).toMatchObject({ pendiente: true });
  });
  it('un registro sin la columna sale con imagenUrl null', async () => {
    bd.respuestas = [{ data: filaCli, error: null }];
    expect(await actualizarCliente('c1', actualizarClienteSchema.parse({ nombre: 'Beta' }))).toMatchObject({ cliente: { imagenUrl: null } });
  });
});
