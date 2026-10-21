import { describe, it, expect } from 'vitest';
import {
  parsearPrecio, conEdicion, precioEfectivo, valorEstimado, totalEstimado, prepararCambios,
  sinGuardados, limpiarEdiciones, ordenarLotes, textoDePrecio, type LotePrecio,
} from '../../frontend/src/lib/precios-lotes';

const lote = (id: string, p: Partial<LotePrecio> = {}): LotePrecio => ({
  id, nombre: id, clase: 'exportacion', stockKg: 100, precioEstimadoKg: null, actualizadoEn: null, ...p,
});

describe('parsearPrecio', () => {
  it('acepta coma, punto, cero y vacío (quitar)', () => {
    expect(parsearPrecio('1,25')).toEqual({ ok: true, valor: 1.25 });
    expect(parsearPrecio('2.5')).toEqual({ ok: true, valor: 2.5 });
    expect(parsearPrecio('0')).toEqual({ ok: true, valor: 0 });
    expect(parsearPrecio('  ')).toEqual({ ok: true, valor: null });
  });
  it('rechaza negativos, texto y notación científica', () => {
    for (const t of ['-1', 'abc', '1e3', '1,2,3', 'Infinity']) expect(parsearPrecio(t).ok).toBe(false);
  });
});

describe('ediciones', () => {
  const a = lote('a', { precioEstimadoKg: 1.5 });
  it('una edición igual a lo guardado no cuenta como cambio', () => {
    expect(conEdicion({}, a, '1,5')).toEqual({});
    expect(conEdicion({}, a, '2')).toEqual({ a: '2' });
  });
  it('no muta el objeto original', () => {
    const base = { a: '2' };
    conEdicion(base, a, '3');
    expect(base).toEqual({ a: '2' });
  });
  it('precioEfectivo usa el guardado si el texto es inválido', () => {
    expect(precioEfectivo(a, { a: 'x' })).toBe(1.5);
    expect(precioEfectivo(a, { a: '' })).toBeNull();
    expect(precioEfectivo(a, { a: '4' })).toBe(4);
  });
  it('valorEstimado y total', () => {
    expect(valorEstimado(10, 2)).toBe(20);
    expect(valorEstimado(10, null)).toBeNull();
    expect(valorEstimado(-5, 2)).toBe(0);
    const ls = [a, lote('b', { stockKg: 10 })];
    expect(totalEstimado(ls, {})).toEqual({ total: 150, conPrecio: 1, sinPrecio: 1 });
    expect(totalEstimado(ls, { b: '3' })).toEqual({ total: 180, conPrecio: 2, sinPrecio: 0 });
  });
});

describe('prepararCambios', () => {
  const ls = [lote('a', { precioEstimadoKg: 1 }), lote('b'), lote('c')];
  it('solo filas modificadas válidas; inválidas aparte', () => {
    const r = prepararCambios(ls, { a: '', b: '2,5', c: '-3' });
    expect(r.cambios).toEqual([
      { id: 'a', nombre: 'a', precioEstimadoKg: null },
      { id: 'b', nombre: 'b', precioEstimadoKg: 2.5 },
    ]);
    expect(r.invalidos).toEqual(['c']);
  });
  it('sinGuardados y limpiarEdiciones', () => {
    expect(sinGuardados({ a: '1', b: '2' }, ['a'])).toEqual({ b: '2' });
    expect(limpiarEdiciones({ a: '1', z: '2' }, ls)).toEqual({ a: '1' });
  });
});

describe('orden y texto', () => {
  it('exportación primero y numérico natural', () => {
    const o = ordenarLotes([
      { clase: 'otro' as const, nombre: 'X' }, { clase: 'exportacion' as const, nombre: 'Lote 10' },
      { clase: 'exportacion' as const, nombre: 'Lote 2' }, { clase: 'trabajo' as const, nombre: 'BGPP' },
    ]);
    expect(o.map(l => l.nombre)).toEqual(['Lote 2', 'Lote 10', 'BGPP', 'X']);
  });
  it('textoDePrecio usa coma', () => {
    expect(textoDePrecio(1.25)).toBe('1,25');
    expect(textoDePrecio(null)).toBe('');
  });
});
