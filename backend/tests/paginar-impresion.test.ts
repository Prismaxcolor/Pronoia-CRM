import { describe, it, expect } from 'vitest';
import { MOVIMIENTOS_POR_PAGINA_IMPRESION, paginarImpresion } from '../../frontend/src/features/estado-cuenta/paginar-impresion';

const filas = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

describe('paginarImpresion', () => {
  it('usa 15 movimientos por página por defecto', () => {
    expect(MOVIMIENTOS_POR_PAGINA_IMPRESION).toBe(15);
  });

  it('devuelve una página vacía cuando no hay filas', () => {
    expect(paginarImpresion([])).toEqual([[]]);
  });

  it('deja en una sola página hasta 15 filas', () => {
    expect(paginarImpresion(filas(15))).toHaveLength(1);
    expect(paginarImpresion(filas(1))).toEqual([[1]]);
  });

  it('abre una segunda página con la fila 16', () => {
    const paginas = paginarImpresion(filas(16));
    expect(paginas.map(p => p.length)).toEqual([15, 1]);
    expect(paginas[1]).toEqual([16]);
  });

  it('conserva el orden y no pierde filas', () => {
    const paginas = paginarImpresion(filas(47));
    expect(paginas.map(p => p.length)).toEqual([15, 15, 15, 2]);
    expect(paginas.flat()).toEqual(filas(47));
  });

  it('no muta la entrada y respeta un tamaño personalizado', () => {
    const entrada = Object.freeze(filas(5));
    expect(paginarImpresion(entrada, 2).map(p => p.length)).toEqual([2, 2, 1]);
    expect(paginarImpresion(entrada, 0)).toHaveLength(5);
  });
});
