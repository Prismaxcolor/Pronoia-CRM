import { describe, it, expect, vi, beforeEach } from 'vitest';

// Los esquemas validan URLs contra ENV.SUPABASE_URL: se fija para no depender del .env local.
vi.mock('../src/config/env.js', async importOriginal => {
  const real = await importOriginal<typeof import('../src/config/env.js')>();
  return { ...real, ENV: { ...real.ENV, SUPABASE_URL: 'https://p.supabase.test' } };
});

type Resp = { data: Record<string, unknown> | null; error: { code?: string; message: string } | null };
const bd = vi.hoisted(() => ({ respuestas: [] as unknown[], escrituras: [] as Array<Record<string, unknown>> }));

vi.mock('../src/config/supabase.js', () => {
  const cadena = (valores: Record<string, unknown>) => {
    bd.escrituras.push(valores);
    const resp = () => Promise.resolve(bd.respuestas.shift() as Resp);
    const c: Record<string, unknown> = {};
    for (const m of ['eq', 'select']) c[m] = () => c;
    c.single = resp;
    c.maybeSingle = resp;
    return c;
  };
  return { supabaseAdmin: { from: () => ({ insert: cadena, update: cadena }) } };
});

import { actualizarBanca, crearBanca } from '../src/services/banca-service.js';
import { actualizarBancaSchema, crearBancaSchema } from '../src/schemas/cochinito.js';
import { esUrlDeBucketValida, esUrlComprobanteValida } from '../src/utils/comprobante-url.js';
import { anotarPuedeEditar, filtrarBancas } from '../src/utils/banca-acceso.js';

const HOST = 'https://p.supabase.test/storage/v1/object/public';
const IMG = `${HOST}/bancas/3f2b1c9e-5a4d-4e0a-9b7a-0c1d2e3f4a5b.png`;
const fila = { id: 'b1', nombre: 'BNC', tipo: 'banco_nacional', saldo: 0, moneda: 'USD', descripcion: '', archivada: false };
const columnaFalta = { code: '42703', message: 'column "imagen_url" of relation "bancas" does not exist' };
const base = { nombre: 'BNC', tipo: 'banco_nacional' as const, moneda: 'USD', descripcion: null };

beforeEach(() => { bd.respuestas = []; bd.escrituras = []; });

describe('esUrlDeBucketValida', () => {
  it('acepta un archivo del bucket pedido y rechaza el de otro bucket', () => {
    expect(esUrlDeBucketValida(IMG, 'https://p.supabase.test', 'bancas')).toBe(true);
    expect(esUrlDeBucketValida(`${HOST}/comprobantes/x.png`, 'https://p.supabase.test', 'bancas')).toBe(false);
  });
  it('rechaza otro host, http, query y escapes de ruta', () => {
    expect(esUrlDeBucketValida(IMG.replace('p.supabase.test', 'evil.test'), 'https://p.supabase.test', 'bancas')).toBe(false);
    expect(esUrlDeBucketValida(IMG.replace('https', 'http'), 'https://p.supabase.test', 'bancas')).toBe(false);
    expect(esUrlDeBucketValida(`${IMG}?x=1`, 'https://p.supabase.test', 'bancas')).toBe(false);
    expect(esUrlDeBucketValida(`${HOST}/bancas/../comprobantes/x.png`, 'https://p.supabase.test', 'bancas')).toBe(false);
  });
  it('esUrlComprobanteValida sigue funcionando igual', () => {
    expect(esUrlComprobanteValida(`${HOST}/comprobantes/x.jpg`, 'https://p.supabase.test')).toBe(true);
    expect(esUrlComprobanteValida(IMG, 'https://p.supabase.test')).toBe(false);
  });
});

describe('imagenUrl en los esquemas de banca', () => {
  it('es opcional: sin el campo, el esquema pasa y no lo trae', () => {
    const r = crearBancaSchema.parse({ nombre: 'BNC', tipo: 'efectivo', moneda: 'USD' });
    expect(r.imagenUrl).toBeUndefined();
  });
  it('acepta una imagen jpg/png/webp del bucket de bancas', () => {
    for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
      const url = `${HOST}/bancas/a.${ext}`;
      expect(actualizarBancaSchema.parse({ imagenUrl: url }).imagenUrl).toBe(url);
    }
  });
  it('null quita la imagen', () => {
    expect(actualizarBancaSchema.parse({ imagenUrl: null }).imagenUrl).toBeNull();
  });
  it('rechaza SVG, otros buckets, otros hosts y texto que no es URL', () => {
    for (const malo of [`${HOST}/bancas/a.svg`, `${HOST}/comprobantes/a.png`, 'https://evil.test/storage/v1/object/public/bancas/a.png', 'logo.png', '']) {
      expect(actualizarBancaSchema.safeParse({ imagenUrl: malo }).success).toBe(false);
    }
  });
});

describe('imagen de banca en el servicio', () => {
  it('crear con imagen la envía y la devuelve como imagenUrl', async () => {
    bd.respuestas = [{ data: { ...fila, imagen_url: IMG }, error: null }];
    const r = await crearBanca({ ...base, imagenUrl: IMG });
    expect(bd.escrituras[0].imagen_url).toBe(IMG);
    expect('imagenUrl' in bd.escrituras[0]).toBe(false);
    expect(r).toMatchObject({ banca: { imagenUrl: IMG } });
  });
  it('crear sin imagen no envía la columna y devuelve imagenUrl null', async () => {
    bd.respuestas = [{ data: fila, error: null }];
    const r = await crearBanca(base);
    expect('imagen_url' in bd.escrituras[0]).toBe(false);
    expect(r).toMatchObject({ banca: { imagenUrl: null } });
  });
  it('editar con imagen y migración sin aplicar responde pendiente (no la descarta en silencio)', async () => {
    bd.respuestas = [{ data: null, error: columnaFalta }];
    const r = await actualizarBanca('b1', { nombre: 'BNC', imagenUrl: IMG });
    expect(r).toMatchObject({ pendiente: true });
    expect(bd.escrituras).toHaveLength(1);
  });
  it('quitar la imagen (null) con migración sin aplicar degrada y guarda el resto', async () => {
    bd.respuestas = [{ data: null, error: columnaFalta }, { data: fila, error: null }];
    const r = await actualizarBanca('b1', { nombre: 'BNC', imagenUrl: null });
    expect(bd.escrituras[1]).toEqual({ nombre: 'BNC' });
    expect('banca' in r).toBe(true);
  });
  it('si falta solo imagen_url, el color sí se conserva en el reintento', async () => {
    bd.respuestas = [{ data: null, error: columnaFalta }, { data: fila, error: null }];
    await actualizarBanca('b1', { color: 'azul', imagenUrl: null });
    expect(bd.escrituras[1]).toEqual({ color: 'azul' });
  });
});

describe('la imagen no se filtra de cuentas sin acceso', () => {
  const bancas = [
    { id: 'bA', nombre: 'Banesco', imagenUrl: IMG },
    { id: 'bB', nombre: 'Caja secreta', imagenUrl: `${HOST}/bancas/secreta.png` },
  ];
  it('el listado solo trae las cuentas permitidas, con su imagen', () => {
    const r = anotarPuedeEditar(filtrarBancas(bancas, new Set(['bA'])), new Set());
    expect(r.map(b => b.id)).toEqual(['bA']);
    expect(JSON.stringify(r)).not.toContain('secreta.png');
  });
});
