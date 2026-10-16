import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buscarCategoriaPorNombre, NOMBRE_CATEGORIA_COMISION_BANCARIA } from '../src/utils/categoria-comision.js';

type Cat = { id: string; nombre: string; tipo: 'INGRESO' | 'EGRESO' | 'AMBOS'; color: string; padreId: string | null; activo: boolean; imagenUrl: null; creadoEn: string };
const cat = (id: string, nombre: string, extra: Partial<Cat> = {}): Cat =>
  ({ id, nombre, tipo: 'EGRESO', color: '#475569', padreId: null, activo: true, imagenUrl: null, creadoEn: '2026-10-16', ...extra });

const bd = vi.hoisted(() => ({
  usos: null as unknown,
  todas: null as unknown,
  aplicados: [] as Array<{ ids: readonly string[]; categoriaId: string | null }>,
}));

vi.mock('../src/services/categorias-uso-service.js', () => ({ categoriasDeUso: async () => bd.usos }));
vi.mock('../src/services/categoria-service.js', () => ({ listarCategorias: async () => bd.todas }));
vi.mock('../src/services/pago-categoria-service.js', () => ({
  aplicarCategoriaAMovimientos: async (ids: readonly string[], categoriaId: string | null) => {
    bd.aplicados.push({ ids, categoriaId });
    return {};
  },
}));

import { aplicarCategoriaAComisiones, categoriaDeComisionBancaria } from '../src/services/comision-categoria-service.js';

beforeEach(() => {
  bd.usos = { categorias: [] };
  bd.todas = { categorias: [] };
  bd.aplicados = [];
});

describe('buscarCategoriaPorNombre', () => {
  it('ignora mayúsculas y espacios sobrantes', () => {
    const c = cat('x', '  comisiones   bancarias ');
    expect(buscarCategoriaPorNombre([cat('a', 'OTRA'), c], NOMBRE_CATEGORIA_COMISION_BANCARIA)).toBe(c);
  });
  it('ignora las tildes', () => {
    const c = cat('y', 'Comisiónes Bancarias');
    expect(buscarCategoriaPorNombre([c], 'COMISIONES BANCARIAS')).toBe(c);
  });
  it('devuelve null si no hay ninguna con ese nombre', () => {
    expect(buscarCategoriaPorNombre([cat('a', 'OTRA')], NOMBRE_CATEGORIA_COMISION_BANCARIA)).toBeNull();
  });
});

describe('categoriaDeComisionBancaria', () => {
  it('usa la categoría del uso comision_bancaria cuando existe', async () => {
    bd.usos = { categorias: [cat('uso-1', 'LO QUE SEA')] };
    expect(await categoriaDeComisionBancaria()).toBe('uso-1');
  });
  it('sin uso configurado busca por nombre entre las categorías activas que admiten egresos', async () => {
    bd.todas = { categorias: [
      cat('arch', 'COMISIONES BANCARIAS', { activo: false }),
      cat('ing', 'COMISIONES BANCARIAS', { tipo: 'INGRESO' }),
      cat('ok', 'COMISIONES BANCARIAS', { padreId: 'gf' }),
    ] };
    expect(await categoriaDeComisionBancaria()).toBe('ok');
  });
  it('si el uso falla con error cae al nombre', async () => {
    bd.usos = { error: 'caída' };
    bd.todas = { categorias: [cat('ok', 'COMISIONES BANCARIAS')] };
    expect(await categoriaDeComisionBancaria()).toBe('ok');
  });
  it('devuelve null si no hay categoría o no se pueden leer las categorías', async () => {
    expect(await categoriaDeComisionBancaria()).toBeNull();
    bd.todas = { error: 'sin tabla' };
    expect(await categoriaDeComisionBancaria()).toBeNull();
  });
});

describe('aplicarCategoriaAComisiones', () => {
  it('pone la categoría a los cargos recibidos', async () => {
    bd.usos = { categorias: [cat('uso-1', 'COMISIONES BANCARIAS')] };
    await aplicarCategoriaAComisiones(['c1', 'c2']);
    expect(bd.aplicados).toEqual([{ ids: ['c1', 'c2'], categoriaId: 'uso-1' }]);
  });
  it('sin cargos no consulta nada', async () => {
    await aplicarCategoriaAComisiones([]);
    expect(bd.aplicados).toEqual([]);
  });
  it('sin categoría existente delega con null (no hace update)', async () => {
    await aplicarCategoriaAComisiones(['c1']);
    expect(bd.aplicados).toEqual([{ ids: ['c1'], categoriaId: null }]);
  });
});
