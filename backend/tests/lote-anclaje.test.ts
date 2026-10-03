import { describe, it, expect } from 'vitest';
import { ordenarLotesPorAnclaje } from '../../shared/types/lote.js';

const lotes = [
  { id: 'a', nombre: 'LOTE 3' },
  { id: 'b', nombre: 'BGPP' },
  { id: 'c', nombre: 'LOTE 1' },
  { id: 'd', nombre: 'PCB LIGADO' },
];

describe('ordenarLotesPorAnclaje', () => {
  it('pone primero los lotes anclados al producto, marcados, y luego el resto', () => {
    const r = ordenarLotesPorAnclaje(lotes, ['d', 'c']);
    expect(r.map(l => [l.id, l.anclado])).toEqual([
      ['c', true], ['d', true], ['b', false], ['a', false],
    ]);
  });
  it('ordena cada grupo por nombre', () => {
    const r = ordenarLotesPorAnclaje(lotes, []);
    expect(r.map(l => l.nombre)).toEqual(['BGPP', 'LOTE 1', 'LOTE 3', 'PCB LIGADO']);
    expect(r.every(l => !l.anclado)).toBe(true);
  });
  it('ignora anclajes a lotes que ya no están disponibles y no muta la entrada', () => {
    const copia = [...lotes];
    const r = ordenarLotesPorAnclaje(lotes, ['zzz']);
    expect(r).toHaveLength(4);
    expect(lotes).toEqual(copia);
  });
});
