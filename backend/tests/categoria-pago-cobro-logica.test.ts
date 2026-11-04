import { describe, it, expect } from 'vitest';
import {
  categoriasParaTipo, conSubcategoriasDeCobro, elegirCategoriaDePago, resolverCategoriaDePago, MENSAJE_PAGO_CATEGORIA_INVALIDA, resolverCategoriaDeCobro,
  MENSAJE_COBRO_CATEGORIA_INVALIDA, MENSAJE_COBRO_SIN_CATEGORIA,
} from '../src/utils/categoria-pago-cobro.js';
import { registrarCobroMultipleSchema } from '../src/schemas/cobros.js';
import type { CategoriaFila } from '../src/utils/categoria-wallet.js';

const cat = (id: string, tipo: CategoriaFila['tipo']): CategoriaFila =>
  ({ id, nombre: id, tipo, color: '#15803D', padreId: null, activo: true });

const NF = cat('nf', 'INGRESO');
const PCB = cat('pcb', 'AMBOS');
const MATERIA = cat('materia', 'EGRESO');

describe('categoriasParaTipo', () => {
  it('deja solo las que aceptan el tipo del movimiento', () => {
    expect(categoriasParaTipo([NF, PCB, MATERIA], 'ingreso').map(c => c.id)).toEqual(['nf', 'pcb']);
    expect(categoriasParaTipo([NF, PCB, MATERIA], 'egreso').map(c => c.id)).toEqual(['pcb', 'materia']);
  });
});

describe('elegirCategoriaDePago', () => {
  it('devuelve la categoría de egreso configurada', () => {
    expect(elegirCategoriaDePago([MATERIA])).toBe('materia');
  });
  it('devuelve null si no hay categorías o ninguna admite egresos', () => {
    expect(elegirCategoriaDePago([])).toBeNull();
    expect(elegirCategoriaDePago([NF])).toBeNull();
  });
});

describe('resolverCategoriaDeCobro', () => {
  it('con dinero exige elegir una categoría', () => {
    expect(resolverCategoriaDeCobro([NF, PCB], null, true)).toEqual({ error: MENSAJE_COBRO_SIN_CATEGORIA });
    expect(resolverCategoriaDeCobro([NF, PCB], undefined, true)).toEqual({ error: MENSAJE_COBRO_SIN_CATEGORIA });
  });
  it('rechaza una categoría que no está entre las opciones', () => {
    expect(resolverCategoriaDeCobro([NF, PCB], 'otra', true)).toEqual({ error: MENSAJE_COBRO_CATEGORIA_INVALIDA });
  });
  it('ignora una opción configurada que no admite ingresos (queda sin categoría)', () => {
    expect(resolverCategoriaDeCobro([MATERIA], 'materia', true)).toEqual({ categoriaId: null });
  });
  it('acepta una de las opciones', () => {
    expect(resolverCategoriaDeCobro([NF, PCB], 'pcb', true)).toEqual({ categoriaId: 'pcb' });
  });
  it('un cruce puro (sin dinero) no lleva categoría aunque venga una', () => {
    expect(resolverCategoriaDeCobro([NF, PCB], 'nf', false)).toEqual({ categoriaId: null });
    expect(resolverCategoriaDeCobro([NF, PCB], null, false)).toEqual({ categoriaId: null });
  });
  it('sin opciones configuradas el cobro funciona como antes (sin categoría, sin exigirla)', () => {
    expect(resolverCategoriaDeCobro([], null, true)).toEqual({ categoriaId: null });
    expect(resolverCategoriaDeCobro([], 'nf', true)).toEqual({ categoriaId: null });
  });
});

describe('registrarCobroMultipleSchema.categoriaId', () => {
  const base = {
    clienteId: '11111111-1111-4111-8111-111111111111',
    bancas: [{ bancaId: '22222222-2222-4222-8222-222222222222', monto: 10, montoUsd: 10, moneda: 'USD' }],
    montoUsd: 10,
    fecha: '2026-10-12',
    items: [],
  };
  it('es opcional', () => {
    expect(registrarCobroMultipleSchema.safeParse(base).success).toBe(true);
    expect(registrarCobroMultipleSchema.safeParse({ ...base, categoriaId: null }).success).toBe(true);
  });
  it('acepta un uuid y rechaza otro texto', () => {
    expect(registrarCobroMultipleSchema.safeParse({ ...base, categoriaId: '33333333-3333-4333-8333-333333333333' }).success).toBe(true);
    expect(registrarCobroMultipleSchema.safeParse({ ...base, categoriaId: 'venta' }).success).toBe(false);
  });
});

describe('conSubcategoriasDeCobro', () => {
  const hija = { ...cat('nf-sub', 'INGRESO'), padreId: 'nf' };
  const hijaEgreso = { ...cat('nf-egr', 'EGRESO'), padreId: 'nf' };
  const hijaArchivada = { ...cat('nf-old', 'INGRESO'), padreId: 'nf', activo: false };
  const ajena = { ...cat('otra', 'INGRESO'), padreId: 'pcb' };

  it('suma las subcategorías vigentes que admiten ingresos de la categoría general asignada', () => {
    const r = conSubcategoriasDeCobro([NF], [NF, hija, hijaEgreso, hijaArchivada, ajena]);
    expect(r.map(c => c.id)).toEqual(['nf', 'nf-sub']);
  });
  it('no repite una subcategoría ya asignada ni expande una subcategoría', () => {
    expect(conSubcategoriasDeCobro([NF, hija], [NF, hija]).map(c => c.id)).toEqual(['nf', 'nf-sub']);
    expect(conSubcategoriasDeCobro([hija], [NF, hija]).map(c => c.id)).toEqual(['nf-sub']);
  });
});

describe('resolverCategoriaDePago', () => {
  const MAT = cat('mat', 'EGRESO');
  it('sin elección devuelve la fija (aunque sea null)', () => {
    expect(resolverCategoriaDePago([MAT], undefined, 'mat')).toEqual({ categoriaId: 'mat' });
    expect(resolverCategoriaDePago([], null, null)).toEqual({ categoriaId: null });
  });
  it('acepta una elegida que es opción de egreso', () => {
    expect(resolverCategoriaDePago([MAT], 'mat', null)).toEqual({ categoriaId: 'mat' });
  });
  it('rechaza una fuera de las opciones o que solo admite ingresos', () => {
    expect(resolverCategoriaDePago([MAT], 'otra', 'mat')).toEqual({ error: MENSAJE_PAGO_CATEGORIA_INVALIDA });
    expect(resolverCategoriaDePago([NF], 'nf', null)).toEqual({ error: MENSAJE_PAGO_CATEGORIA_INVALIDA });
  });
  it('conSubcategoriasDeCobro puede expandir con el tipo egreso', () => {
    const hija = { ...cat('h', 'EGRESO'), padreId: 'mat' };
    const hijaIngreso = { ...cat('hi', 'INGRESO'), padreId: 'mat' };
    expect(conSubcategoriasDeCobro([MAT], [MAT, hija, hijaIngreso], 'egreso').map(c => c.id)).toEqual(['mat', 'h']);
  });
});
