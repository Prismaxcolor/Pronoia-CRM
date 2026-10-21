import { describe, it, expect } from 'vitest';
import {
  derivarAlcance,
  validarAlcance,
  buscarTomaSolapada,
  lineasLotesSinContar,
  categoriaSinLoteEfectivo,
} from '../src/utils/toma-fisica-alcance.js';
import { crearTomaFisicaSchema } from '../src/schemas/toma-fisica.js';

const A = '11111111-1111-4111-8111-111111111111';
const CAT_FERROSO = '22222222-2222-4222-8222-222222222222';
const CAT_PCB = '33333333-3333-4333-8333-333333333333';
const LOTE_1 = '44444444-4444-4444-8444-444444444444';
const LOTE_2 = '55555555-5555-4555-8555-555555555555';

const ferroso = { id: CAT_FERROSO, sinLote: true };
const pcb = { id: CAT_PCB, sinLote: false };

describe('derivarAlcance (tomas existentes sin columna de alcance)', () => {
  it('con lotes elegidos es por lote', () => {
    expect(derivarAlcance([LOTE_1], [false])).toBe('lote');
  });
  it('categoría con lote sin lote_ids (todos los lotes) sigue siendo por lote', () => {
    expect(derivarAlcance(null, [false])).toBe('lote');
  });
  it('solo categorías sin lote es por categoría', () => {
    expect(derivarAlcance(null, [true, true])).toBe('categoria');
    expect(derivarAlcance([], [true])).toBe('categoria');
  });
});

describe('validarAlcance', () => {
  it('por categoría: acepta categorías sin lote', () => {
    expect(validarAlcance({ alcance: 'categoria', categorias: [ferroso], loteIds: [] })).toBeNull();
  });
  it('por categoría: exige al menos una categoría', () => {
    expect(validarAlcance({ alcance: 'categoria', categorias: [], loteIds: [] })).toMatch(/al menos una categoría/);
  });
  it('por categoría: rechaza categorías con lote (se cuentan por lote)', () => {
    expect(validarAlcance({ alcance: 'categoria', categorias: [ferroso, pcb], loteIds: [] })).toMatch(/por lote/i);
  });
  it('por categoría: rechaza lotes sueltos', () => {
    expect(validarAlcance({ alcance: 'categoria', categorias: [ferroso], loteIds: [LOTE_1] })).toMatch(/lotes/i);
  });
  it('por lote: exige al menos un lote', () => {
    expect(validarAlcance({ alcance: 'lote', categorias: [pcb], loteIds: [] })).toMatch(/al menos un lote/);
  });
  it('por lote: exige categoría con lote y rechaza sin lote', () => {
    expect(validarAlcance({ alcance: 'lote', categorias: [], loteIds: [LOTE_1] })).toMatch(/categoría/);
    expect(validarAlcance({ alcance: 'lote', categorias: [ferroso], loteIds: [LOTE_1] })).toMatch(/con lote/);
  });
  it('por lote: acepta categoría con lote y lotes', () => {
    expect(validarAlcance({ alcance: 'lote', categorias: [pcb], loteIds: [LOTE_1, LOTE_2] })).toBeNull();
  });
});

describe('buscarTomaSolapada', () => {
  const abierta = { id: 't1', codigo: 'INV-0011', almacenId: A, categoriaIds: [CAT_PCB], estado: 'abierta' as const };

  it('detecta toma abierta del mismo almacén con categoría en común', () => {
    expect(buscarTomaSolapada({ almacenId: A, categoriaIds: [CAT_PCB, CAT_FERROSO] }, [abierta])?.codigo).toBe('INV-0011');
  });
  it('ignora otro almacén, otra categoría o tomas no abiertas', () => {
    expect(buscarTomaSolapada({ almacenId: 'otro', categoriaIds: [CAT_PCB] }, [abierta])).toBeNull();
    expect(buscarTomaSolapada({ almacenId: A, categoriaIds: [CAT_FERROSO] }, [abierta])).toBeNull();
    expect(buscarTomaSolapada({ almacenId: A, categoriaIds: [CAT_PCB] }, [{ ...abierta, estado: 'cerrada' as const }])).toBeNull();
  });
});

describe('lineasLotesSinContar', () => {
  it('agrega los lotes del alcance que aún no tienen línea, con su teórico', () => {
    const lineas = [{ productoId: null, loteId: LOTE_1 }];
    const faltan = lineasLotesSinContar([LOTE_1, LOTE_2], lineas, new Map([[LOTE_2, 12.5]]), new Map([[LOTE_2, 'Lote B']]));
    expect(faltan).toEqual([
      {
        productoId: null, productoNombre: null, loteId: LOTE_2, loteNombre: 'Lote B',
        stockTeorico: 12.5, stockReal: 0, diferencia: 0, cantidadPesajes: 0,
      },
    ]);
  });
  it('no agrega nada si todos ya están', () => {
    expect(lineasLotesSinContar([LOTE_1], [{ productoId: null, loteId: LOTE_1 }], new Map(), new Map())).toEqual([]);
  });
});

describe('crearTomaFisicaSchema alcance', () => {
  const base = { almacenId: A, categoriaIds: [CAT_PCB], descripcion: '' };
  it('acepta alcance explícito', () => {
    expect(crearTomaFisicaSchema.safeParse({ ...base, alcance: 'lote', loteIds: [LOTE_1] }).success).toBe(true);
    expect(crearTomaFisicaSchema.safeParse({ ...base, alcance: 'categoria' }).success).toBe(true);
  });
  it('rechaza alcance desconocido', () => {
    expect(crearTomaFisicaSchema.safeParse({ ...base, alcance: 'otro' }).success).toBe(false);
  });
  it('sin alcance sigue válido (clientes viejos)', () => {
    expect(crearTomaFisicaSchema.safeParse(base).success).toBe(true);
  });
});

describe('categoriaSinLoteEfectivo (lotes anclados a productos)', () => {
  it('categoría sin lote y sin productos anclados sigue siendo por categoría', () => {
    expect(categoriaSinLoteEfectivo(true, false)).toBe(true);
  });
  it('categoría sin lote con algún producto anclado pasa a inventariarse por lote', () => {
    expect(categoriaSinLoteEfectivo(true, true)).toBe(false);
  });
  it('categoría marcada con lote sigue siendo por lote aunque no tenga anclajes', () => {
    expect(categoriaSinLoteEfectivo(false, false)).toBe(false);
    expect(categoriaSinLoteEfectivo(false, true)).toBe(false);
  });
});
