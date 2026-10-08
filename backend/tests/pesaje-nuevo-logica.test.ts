import { describe, it, expect } from 'vitest';
import type { MaterialFila } from '../../frontend/src/features/pesaje/material-fila';
import {
  categoriaVigente,
  faltantesFila,
  faltantesParaAgregar,
  guardarCategoriaRecordada,
  leerCategoriaRecordada,
  productoRequiereLote,
  ticketsBrutoDeEntidad,
} from '../../frontend/src/features/pesaje/pesaje-nuevo-logica';

const fila = (extra: Partial<MaterialFila> = {}): MaterialFila => ({
  uid: 1, productoId: 'p1', subcategoria: '', pesoBruto: '10', taraModo: 'manual', taraId: '',
  taraCantidad: '', taraManual: '', destino: 'l1',
  fotos: [{ tipo: 'subida', url: 'https://x/f.jpg' }] as unknown as MaterialFila['fotos'], ...extra,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const catalogo = (...p: unknown[]) => p as any;
const conLote = { id: 'p1', tipoMaterialSinLote: false, loteIds: ['l1'] };
const sinLote = { id: 'p2', tipoMaterialSinLote: true, loteIds: [] };

describe('faltantesFila', () => {
  it('fila completa no tiene faltantes', () => {
    expect(faltantesFila(fila(), catalogo(conLote))).toEqual([]);
  });
  it('fila vacía lista tipo de material, peso y foto (sin lote aún)', () => {
    const vacia = fila({ productoId: '', pesoBruto: '', destino: '', fotos: [] });
    expect(faltantesFila(vacia, catalogo(conLote))).toEqual(['tipo de material', 'peso', 'foto del peso bruto']);
  });
  it('pide lote si el material lo maneja y no hay destino', () => {
    expect(faltantesFila(fila({ destino: '' }), catalogo(conLote))).toEqual(['lote']);
  });
  it('no pide lote si el material es sin lote', () => {
    expect(faltantesFila(fila({ productoId: 'p2', destino: '' }), catalogo(sinLote))).toEqual([]);
  });
  it('peso cero o negativo cuenta como faltante', () => {
    expect(faltantesFila(fila({ pesoBruto: '0' }), catalogo(conLote))).toEqual(['peso']);
  });
});

describe('faltantesParaAgregar', () => {
  it('evalúa solo la última fila', () => {
    const filas = [fila({ uid: 1, fotos: [] }), fila({ uid: 2 })];
    expect(faltantesParaAgregar(filas, catalogo(conLote))).toEqual([]);
  });
  it('sin filas no bloquea', () => {
    expect(faltantesParaAgregar([], catalogo(conLote))).toEqual([]);
  });
});

describe('productoRequiereLote', () => {
  it('true para material con lote, false para sin lote o desconocido', () => {
    expect(productoRequiereLote('p1', catalogo(conLote, sinLote))).toBe(true);
    expect(productoRequiereLote('p2', catalogo(conLote, sinLote))).toBe(false);
    expect(productoRequiereLote('zz', catalogo(conLote))).toBe(false);
  });
});

describe('ticketsBrutoDeEntidad', () => {
  const t = (id: string, entidadId: string, estado: 'bruto' | 'completo') => ({ id, entidadId, estado }) as never;
  it('filtra por proveedor y estado bruto', () => {
    const lista = [t('a', 'e1', 'bruto'), t('b', 'e1', 'completo'), t('c', 'e2', 'bruto')];
    expect(ticketsBrutoDeEntidad(lista, 'e1')).toHaveLength(1);
  });
  it('sin proveedor devuelve vacío', () => {
    expect(ticketsBrutoDeEntidad([t('a', 'e1', 'bruto')], '')).toEqual([]);
  });
});

describe('categoría recordada', () => {
  const memoria = () => {
    const datos = new Map<string, string>();
    return { getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => { datos.set(k, v); } };
  };
  it('guarda y lee la categoría', () => {
    const m = memoria();
    guardarCategoriaRecordada('c1', m);
    expect(leerCategoriaRecordada(m)).toBe('c1');
  });
  it('"Todas" (null) se lee como null', () => {
    const m = memoria();
    guardarCategoriaRecordada('c1', m);
    guardarCategoriaRecordada(null, m);
    expect(leerCategoriaRecordada(m)).toBeNull();
  });
  it('no falla si el almacenamiento lanza', () => {
    const roto = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(() => guardarCategoriaRecordada('c1', roto)).not.toThrow();
    expect(leerCategoriaRecordada(roto)).toBeNull();
  });
  it('categoriaVigente descarta ids que ya no existen', () => {
    expect(categoriaVigente('c1', ['c1', 'c2'])).toBe('c1');
    expect(categoriaVigente('c9', ['c1'])).toBeNull();
    expect(categoriaVigente(null, ['c1'])).toBeNull();
  });
});
