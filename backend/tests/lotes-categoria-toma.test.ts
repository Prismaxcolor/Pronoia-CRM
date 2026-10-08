import { describe, it, expect } from 'vitest';
import { lotesElegiblesParaToma, esLoteCatalizadores } from '../src/utils/lotes-categoria-toma.js';
import { resolverProductosToma } from '../src/utils/toma-fisica-alcance.js';

const PCB = { id: 'cat-pcb', nombre: 'PCB' };
const PGM = { id: 'cat-pgm', nombre: 'PGM' };
const TODAS = [PCB, PGM, { id: 'cat-fer', nombre: 'Ferroso' }];

const lotes = [
  { id: 'l1', nombre: 'LOTE 1', categoriaIdsAncladas: ['cat-pcb'] },
  { id: 'l2', nombre: 'LOTE 2', categoriaIdsAncladas: [] },
  { id: 'l3', nombre: 'LOTE 3', categoriaIdsAncladas: ['cat-pcb'] },
  { id: 'l4', nombre: 'LOTE 4', categoriaIdsAncladas: ['cat-pgm'] },
  { id: 'bgpp', nombre: 'BGPP', categoriaIdsAncladas: [] },
];

describe('lotesElegiblesParaToma', () => {
  it('PCB ofrece los lotes de PCB y nunca el Lote 4', () => {
    expect(lotesElegiblesParaToma(lotes, [PCB], TODAS)).toEqual(['l1', 'l2', 'l3', 'bgpp']);
  });

  it('PGM ofrece solamente el Lote 4', () => {
    expect(lotesElegiblesParaToma(lotes, [PGM], TODAS)).toEqual(['l4']);
  });

  it('reconoce el Lote 4 por nombre aunque no tenga anclajes o los tenga mezclados', () => {
    const sinAnclas = [{ id: 'x', nombre: ' lote  4 ', categoriaIdsAncladas: [] }];
    const mezclado = [{ id: 'y', nombre: 'LOTE 4', categoriaIdsAncladas: ['cat-pcb', 'cat-pgm'] }];
    expect(lotesElegiblesParaToma(sinAnclas, [PGM], TODAS)).toEqual(['x']);
    expect(lotesElegiblesParaToma(mezclado, [PCB], TODAS)).toEqual([]);
    expect(lotesElegiblesParaToma(mezclado, [PGM], TODAS)).toEqual(['y']);
  });

  it('un lote cuyos productos anclados son todos PGM es de catalizadores aunque no se llame Lote 4', () => {
    const otro = { id: 'z', nombre: 'LOTE 5', categoriaIdsAncladas: ['cat-pgm'] };
    expect(esLoteCatalizadores(otro, new Set(['cat-pgm']))).toBe(true);
    expect(esLoteCatalizadores({ ...otro, categoriaIdsAncladas: ['cat-pgm', 'cat-pcb'] }, new Set(['cat-pgm']))).toBe(false);
  });
});

describe('resolverProductosToma', () => {
  const activos = [
    { id: 'a', categoriaId: 'cat-no' }, { id: 'b', categoriaId: 'cat-no' }, { id: 'c', categoriaId: 'cat-no' },
    { id: 'z', categoriaId: 'otra' },
  ];

  it('sin selección cuenta toda la categoría (null)', () => {
    expect(resolverProductosToma(undefined, activos, ['cat-no'])).toEqual({ productoIds: null });
  });

  it('con todos los materiales marcados no guarda lista (comportamiento de siempre)', () => {
    expect(resolverProductosToma(['c', 'a', 'b', 'a'], activos, ['cat-no'])).toEqual({ productoIds: null });
  });

  it('una selección parcial se guarda tal cual', () => {
    expect(resolverProductosToma(['a', 'c'], activos, ['cat-no'])).toEqual({ productoIds: ['a', 'c'] });
  });

  it('rechaza lista vacía y materiales de otra categoría o inexistentes', () => {
    expect(resolverProductosToma([], activos, ['cat-no'])).toHaveProperty('error');
    expect(resolverProductosToma(['a', 'z'], activos, ['cat-no'])).toHaveProperty('error');
    expect(resolverProductosToma(['nope'], activos, ['cat-no'])).toHaveProperty('error');
  });
});
