import { describe, it, expect } from 'vitest';
import { ordenarLotesPorAnclaje, lotesSeleccionables } from '../../shared/types/lote.js';

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

describe('lotesSeleccionables', () => {
  it('sin anclajes devuelve todos los lotes ordenados, sin restringir', () => {
    const r = lotesSeleccionables(lotes, []);
    expect(r.restringido).toBe(false);
    expect(r.sinDisponibles).toBe(false);
    expect(r.opciones.map(l => l.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(r.opciones.every(l => !l.anclado && !l.actualNoAnclado)).toBe(true);
  });
  it('con anclajes solo devuelve los anclados (las estrellitas)', () => {
    const r = lotesSeleccionables(lotes, ['d', 'c']);
    expect(r.restringido).toBe(true);
    expect(r.sinDisponibles).toBe(false);
    expect(r.opciones.map(l => [l.id, l.anclado, l.actualNoAnclado])).toEqual([
      ['c', true, false], ['d', true, false],
    ]);
  });
  it('conserva el lote actual no anclado marcado como actualNoAnclado', () => {
    const r = lotesSeleccionables(lotes, ['c'], 'a');
    expect(r.opciones.map(l => [l.id, l.anclado, l.actualNoAnclado])).toEqual([
      ['c', true, false], ['a', false, true],
    ]);
  });
  it('si el lote actual ya está anclado no lo duplica ni lo marca', () => {
    const r = lotesSeleccionables(lotes, ['c'], 'c');
    expect(r.opciones.map(l => [l.id, l.actualNoAnclado])).toEqual([['c', false]]);
  });
  it('anclados todos no disponibles: sinDisponibles true y solo queda el actual', () => {
    const vacio = lotesSeleccionables(lotes, ['zzz']);
    expect(vacio.restringido).toBe(true);
    expect(vacio.sinDisponibles).toBe(true);
    expect(vacio.opciones).toEqual([]);
    const conActual = lotesSeleccionables(lotes, ['zzz'], 'b');
    expect(conActual.sinDisponibles).toBe(true);
    expect(conActual.opciones.map(l => [l.id, l.actualNoAnclado])).toEqual([['b', true]]);
  });
  it('ignora un lote actual que no existe y no muta la entrada', () => {
    const copia = [...lotes];
    const r = lotesSeleccionables(lotes, ['c'], 'nope');
    expect(r.opciones.map(l => l.id)).toEqual(['c']);
    expect(lotes).toEqual(copia);
  });
});
