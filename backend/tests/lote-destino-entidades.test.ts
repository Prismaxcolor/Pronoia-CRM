import { describe, it, expect } from 'vitest';
import { entidadesDestinoLote, nombreDestinoLote } from '../../frontend/src/features/pesaje/lote-destino';
import type { Lote } from '../../shared/types/lote';

const lote = (id: string, nombre: string, extra: Partial<Lote> = {}): Lote => ({
  id, nombre, activo: true, stockPorAlmacen: [], fotos: [], createdAt: '', stockKg: 0, composicion: [], ...extra,
});

const lotes = [lote('a', 'LOTE 2', { stockKg: 12.5, fotos: ['u1', 'u2'] }), lote('b', 'LOTE 1'), lote('c', 'LOTE 3')];

describe('entidadesDestinoLote', () => {
  it('sin anclajes lista todos, sin destacar, con stock y fotos', () => {
    const r = entidadesDestinoLote(lotes, []);
    expect(r.entidades.map(e => e.id)).toEqual(['b', 'a', 'c']);
    expect(r.entidades.every(e => !e.destacado)).toBe(true);
    expect(r.entidades.find(e => e.id === 'a')).toMatchObject({ fotos: ['u1', 'u2'], detalle: 'Stock: 12.50 kg' });
    expect(r.hayAnclados).toBe(false);
    expect(r.sinDisponibles).toBe(false);
  });
  it('con anclajes solo muestra los anclados, destacados', () => {
    const r = entidadesDestinoLote(lotes, ['c']);
    expect(r.entidades.map(e => [e.id, e.destacado])).toEqual([['c', true]]);
    expect(r.hayAnclados).toBe(true);
  });
  it('conserva el lote actual no anclado con su marca', () => {
    const r = entidadesDestinoLote(lotes, ['c'], 'a');
    expect(r.entidades.map(e => e.id)).toEqual(['c', 'a']);
    expect(r.entidades[1]).toMatchObject({ destacado: false, nombre: 'LOTE 2 (actual, no anclado)' });
  });
  it('marca sinDisponibles cuando los anclados no existen/están inactivos', () => {
    const r = entidadesDestinoLote(lotes, ['zzz']);
    expect(r.entidades).toEqual([]);
    expect(r.sinDisponibles).toBe(true);
  });
});

describe('nombreDestinoLote', () => {
  it('devuelve el nombre o null si no hay lote elegido', () => {
    expect(nombreDestinoLote(lotes, 'a')).toBe('LOTE 2');
    expect(nombreDestinoLote(lotes, '')).toBeNull();
    expect(nombreDestinoLote(lotes, 'x')).toBeNull();
  });
});
