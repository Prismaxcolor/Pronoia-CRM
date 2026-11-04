import { describe, it, expect } from 'vitest';
import { reordenarPreciosSchema } from '../src/schemas/listas-precios';
import { moverElemento } from '../../frontend/src/lib/orden-precios';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('reordenarPreciosSchema', () => {
  it('acepta ids únicos', () => {
    expect(reordenarPreciosSchema.safeParse({ productoIds: [A, B] }).success).toBe(true);
  });
  it('rechaza vacío, repetidos y no-uuid', () => {
    expect(reordenarPreciosSchema.safeParse({ productoIds: [] }).success).toBe(false);
    expect(reordenarPreciosSchema.safeParse({ productoIds: [A, A] }).success).toBe(false);
    expect(reordenarPreciosSchema.safeParse({ productoIds: ['x'] }).success).toBe(false);
  });
});

describe('moverElemento', () => {
  it('mueve hacia abajo y hacia arriba sin mutar el original', () => {
    const base = ['a', 'b', 'c', 'd'];
    expect(moverElemento(base, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moverElemento(base, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(base).toEqual(['a', 'b', 'c', 'd']);
  });
  it('índices inválidos o iguales devuelven copia igual', () => {
    expect(moverElemento(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
    expect(moverElemento(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});
