import { describe, it, expect, vi, beforeEach } from 'vitest';

// Los esquemas validan URLs contra ENV.SUPABASE_URL: se fija para no depender del .env local.
vi.mock('../src/config/env.js', async importOriginal => {
  const real = await importOriginal<typeof import('../src/config/env.js')>();
  return { ...real, ENV: { ...real.ENV, SUPABASE_URL: 'https://p.supabase.test' } };
});

type Resp = { data: Record<string, unknown> | null; error: { code?: string; message: string } | null };
const bd = vi.hoisted(() => ({ respuestas: [] as unknown[], escrituras: [] as Array<Record<string, unknown>>, lista: [] as Array<Record<string, unknown>> }));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: () => {
      const resp = () => Promise.resolve(bd.respuestas.shift() as Resp);
      const c: Record<string, unknown> = {};
      for (const m of ['eq', 'select', 'order', 'limit']) c[m] = () => c;
      c.insert = (v: Record<string, unknown>) => { bd.escrituras.push(v); return c; };
      c.update = (v: Record<string, unknown>) => { bd.escrituras.push(v); return c; };
      c.single = resp;
      c.maybeSingle = resp;
      c.then = (ok: (r: unknown) => unknown) => Promise.resolve({ data: bd.lista, error: null }).then(ok);
      return c;
    },
  },
}));

import { actualizarCategoria, crearCategoria, listarCategorias } from '../src/services/categoria-service.js';
import { actualizarCategoriaSchema, crearCategoriaSchema } from '../src/schemas/categorias-wallet.js';

const HOST = 'https://p.supabase.test/storage/v1/object/public';
const IMG = `${HOST}/categorias/3f2b1c9e-5a4d-4e0a-9b7a-0c1d2e3f4a5b.png`;
const fila = { id: 'c1', nombre: 'Servicios', tipo: 'EGRESO', color: '#DC2626', padre_id: null, activo: true, created_at: '2026-10-01T00:00:00Z' };
const columnaFalta = { code: '42703', message: 'column "imagen_url" of relation "categorias_wallet" does not exist' };

beforeEach(() => { bd.respuestas = []; bd.escrituras = []; bd.lista = [fila]; });

describe('imagenUrl en los esquemas de categoría', () => {
  it('es opcional: sin el campo, el esquema pasa y no lo trae', () => {
    expect(crearCategoriaSchema.parse({ nombre: 'A', tipo: 'EGRESO' }).imagenUrl).toBeUndefined();
  });
  it('acepta imágenes jpg/png/webp del bucket de categorías y null', () => {
    expect(crearCategoriaSchema.parse({ nombre: 'A', tipo: 'EGRESO', imagenUrl: IMG }).imagenUrl).toBe(IMG);
    expect(crearCategoriaSchema.parse({ nombre: 'A', tipo: 'EGRESO', imagenUrl: IMG.replace('.png', '.webp') }).imagenUrl).toContain('.webp');
    expect(actualizarCategoriaSchema.parse({ imagenUrl: null })).toEqual({ imagenUrl: null });
  });
  it('rechaza otro bucket, otro host, http, svg y texto que no es URL', () => {
    const malas = [
      IMG.replace('/categorias/', '/bancas/'),
      IMG.replace('p.supabase.test', 'evil.test'),
      IMG.replace('https', 'http'),
      IMG.replace('.png', '.svg'),
      'no-es-url',
    ];
    for (const imagenUrl of malas) {
      expect(crearCategoriaSchema.safeParse({ nombre: 'A', tipo: 'EGRESO', imagenUrl }).success).toBe(false);
    }
  });
  it('actualizar con solo imagenUrl cuenta como un cambio', () => {
    expect(actualizarCategoriaSchema.safeParse({ imagenUrl: IMG }).success).toBe(true);
  });
});

describe('imagenUrl en el servicio de categorías', () => {
  it('lista: mapea imagen_url a imagenUrl y null si falta la columna', async () => {
    bd.lista = [{ ...fila, imagen_url: IMG }, { ...fila, id: 'c2' }];
    const r = await listarCategorias();
    expect(r).toMatchObject({ categorias: [{ id: 'c1', imagenUrl: IMG }, { id: 'c2', imagenUrl: null }] });
  });
  it('crear: escribe imagen_url solo si viene', async () => {
    bd.respuestas = [{ data: { ...fila, imagen_url: IMG }, error: null }];
    const r = await crearCategoria({ nombre: 'Servicios', tipo: 'EGRESO', color: '#DC2626', padreId: null, imagenUrl: IMG }, 'u1');
    expect(bd.escrituras[0]).toMatchObject({ imagen_url: IMG });
    expect(r).toMatchObject({ categoria: { imagenUrl: IMG } });
  });
  it('crear sin imagen no manda la columna (no depende de la migración)', async () => {
    bd.respuestas = [{ data: fila, error: null }];
    await crearCategoria({ nombre: 'Servicios', tipo: 'EGRESO', color: '#DC2626', padreId: null }, 'u1');
    expect(bd.escrituras[0]).not.toHaveProperty('imagen_url');
  });
  it('crear con imagen y columna inexistente => 409 con el nombre de la migración', async () => {
    bd.respuestas = [{ data: null, error: columnaFalta }];
    const r = await crearCategoria({ nombre: 'S', tipo: 'EGRESO', color: '#DC2626', padreId: null, imagenUrl: IMG }, 'u1');
    expect(r).toMatchObject({ codigo: 409 });
    expect('error' in r && r.error).toContain('migration_categorias_imagen.sql');
  });
  it('actualizar: pasa imagenUrl a imagen_url y permite quitarla con null', async () => {
    bd.respuestas = [{ data: fila, error: null }];
    await actualizarCategoria('c1', { imagenUrl: null });
    expect(bd.escrituras[0]).toEqual({ imagen_url: null });
  });
  it('actualizar otros campos con columna inexistente y sin imagen que guardar sigue funcionando', async () => {
    bd.respuestas = [{ data: fila, error: null }];
    const r = await actualizarCategoria('c1', { nombre: 'Nuevo' });
    expect(bd.escrituras[0]).toEqual({ nombre: 'Nuevo' });
    expect(r).toMatchObject({ categoria: { id: 'c1' } });
  });
  it('actualizar con null y columna inexistente: se descarta y reintenta sin la columna', async () => {
    bd.respuestas = [{ data: null, error: columnaFalta }, { data: fila, error: null }];
    const r = await actualizarCategoria('c1', { nombre: 'N', imagenUrl: null });
    expect(bd.escrituras[1]).toEqual({ nombre: 'N' });
    expect(r).toMatchObject({ categoria: { id: 'c1' } });
  });
  it('actualizar con imagen y columna inexistente => 409', async () => {
    bd.respuestas = [{ data: null, error: columnaFalta }];
    const r = await actualizarCategoria('c1', { imagenUrl: IMG });
    expect(r).toMatchObject({ codigo: 409 });
  });
});
