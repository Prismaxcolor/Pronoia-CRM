import { describe, it, expect } from 'vitest';
import { ordenarListado, ORDEN_POR_DEFECTO, type Ordenable } from '../../frontend/src/lib/orden-listado';

const reg = (numero: number | null, createdAt: string, completadoEn: string | null): Ordenable => ({
  numero, createdAt, completadoEn,
});

const A = reg(1, '2026-09-01T10:00:00Z', '2026-09-03T10:00:00Z');
const B = reg(2, '2026-09-02T10:00:00Z', '2026-09-05T10:00:00Z');
const C = reg(3, '2026-09-03T10:00:00Z', '2026-09-04T10:00:00Z');
const PENDIENTE = reg(4, '2026-09-04T10:00:00Z', null);
const ident = (x: Ordenable) => x;

describe('ordenarListado', () => {
  it('por defecto pone primero el último terminado', () => {
    expect(ordenarListado([A, B, C], ORDEN_POR_DEFECTO, ident)).toEqual([B, C, A]);
  });

  it('ordena por fecha de inicio ascendente', () => {
    expect(ordenarListado([C, A, B], { campo: 'inicio', sentido: 'asc' }, ident)).toEqual([A, B, C]);
  });

  it('ordena por correlativo descendente', () => {
    expect(ordenarListado([A, C, B], { campo: 'correlativo', sentido: 'desc' }, ident)).toEqual([C, B, A]);
  });

  it('los no terminados quedan al final en ambos sentidos', () => {
    expect(ordenarListado([PENDIENTE, A, B], { campo: 'culminacion', sentido: 'desc' }, ident).at(-1)).toBe(PENDIENTE);
    expect(ordenarListado([PENDIENTE, A, B], { campo: 'culminacion', sentido: 'asc' }, ident).at(-1)).toBe(PENDIENTE);
  });

  it('los sin correlativo quedan al final', () => {
    const sinNumero = reg(null, '2026-09-09T10:00:00Z', null);
    expect(ordenarListado([sinNumero, A], { campo: 'correlativo', sentido: 'desc' }, ident)).toEqual([A, sinNumero]);
  });

  it('desempata por fecha de inicio más reciente y no muta la lista original', () => {
    const x = reg(5, '2026-09-01T00:00:00Z', '2026-09-10T00:00:00Z');
    const y = reg(6, '2026-09-02T00:00:00Z', '2026-09-10T00:00:00Z');
    const original = [x, y];
    expect(ordenarListado(original, ORDEN_POR_DEFECTO, ident)).toEqual([y, x]);
    expect(original).toEqual([x, y]);
  });
});
