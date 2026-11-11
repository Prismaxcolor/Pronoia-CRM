import { describe, it, expect } from 'vitest';
import {
  ESQUEMA_REGISTROS, contarFiltrosAvanzados, eleccionCategoriaDeUrl, filtrarRegistros, hayFiltrosActivos,
} from '../../frontend/src/features/wallet/registros/registros-filtros';
import { escribirFiltros, leerFiltros } from '../../frontend/src/lib/filtros-url';
import type { CategoriaWallet, Movimiento } from '../../shared/types/index.js';

const mov = (id: string, extra: Partial<Movimiento> = {}): Movimiento => ({
  id, tipo: 'egreso', monto: 10, moneda: 'USD', descripcion: '', bancaOrigenId: 'a', bancaDestinoId: null,
  fecha: '2026-11-11', referencia: '', registradoPor: 'u', proveedorId: null, clienteId: null, montoUsd: null,
  montoDestino: null, creadoEn: '2026-11-11T10:00:00Z', subtipo: null, numero: null, numeroSistema: null, grupoId: null,
  comprobantes: [], anulado: false, anuladoMotivo: null, anuladoEn: null, anuladoPor: null, ...extra,
});

const cat = (id: string, padreId: string | null = null): CategoriaWallet =>
  ({ id, nombre: id, padreId, color: '#000000' } as unknown as CategoriaWallet);
const CATEGORIAS = [cat('comida'), cat('super', 'comida'), cat('rest', 'comida'), cat('sueldo')];

const BASE = { q: '', desde: '2026-11-01', hasta: '2026-11-30', cuentas: [], incluirAnulados: true, categorias: CATEGORIAS };
const ids = (r: Movimiento[]) => r.map(m => m.id);

const datos = [
  mov('e1', { categoriaId: 'super', subtipo: 'pago', grupoId: 'g' }),
  mov('e2', { categoriaId: 'rest' }),
  mov('i1', { tipo: 'ingreso', categoriaId: 'sueldo' }),
  mov('t1', { tipo: 'transferencia', bancaDestinoId: 'b' }),
  mov('s1', {}),
  mov('x1', { anulado: true }),
  mov('fuera', { fecha: '2026-10-01' }),
];

describe('filtrarRegistros', () => {
  it('filtra por período y por tipo', () => {
    expect(ids(filtrarRegistros(datos, { ...BASE, tipo: 'ingreso' }))).toEqual(['i1']);
    expect(ids(filtrarRegistros(datos, { ...BASE, tipo: 'transferencia' }))).toEqual(['t1']);
    expect(ids(filtrarRegistros(datos, BASE))).not.toContain('fuera');
  });

  it('pago o adelanto', () => {
    expect(ids(filtrarRegistros(datos, { ...BASE, subtipo: 'pago' }))).toEqual(['e1']);
  });

  it('categoría incluye sus subcategorías; la subcategoría filtra solo esa', () => {
    expect(ids(filtrarRegistros(datos, { ...BASE, categoria: 'comida' }))).toEqual(['e1', 'e2']);
    expect(ids(filtrarRegistros(datos, { ...BASE, categoria: 'comida', subcategoria: 'rest' }))).toEqual(['e2']);
  });

  it('"Sin categoría" deja solo ingresos y egresos sin categoría', () => {
    expect(ids(filtrarRegistros(datos, { ...BASE, categoria: 'sin' }))).toEqual(['s1', 'x1']);
  });

  it('cuentas: origen o destino', () => {
    expect(ids(filtrarRegistros(datos, { ...BASE, cuentas: ['b'] }))).toEqual(['t1']);
  });

  it('anulados: se incluyen por defecto y se pueden ocultar', () => {
    expect(ids(filtrarRegistros(datos, BASE))).toContain('x1');
    expect(ids(filtrarRegistros(datos, { ...BASE, incluirAnulados: false }))).not.toContain('x1');
  });

  it('no muta la entrada', () => {
    const copia = JSON.stringify(datos);
    filtrarRegistros(datos, { ...BASE, tipo: 'egreso' });
    expect(JSON.stringify(datos)).toBe(copia);
  });
});

describe('parámetro cat (enlaces desde Estadísticas)', () => {
  it('una categoría raíz', () => {
    expect(eleccionCategoriaDeUrl({ cat: 'comida' }, CATEGORIAS)).toEqual({ categoria: 'comida' });
  });
  it('una subcategoría se expresa como categoría + subcategoría', () => {
    expect(eleccionCategoriaDeUrl({ cat: 'super' }, CATEGORIAS)).toEqual({ categoria: 'comida', subcategoria: 'super' });
  });
  it('"sin" es Sin categoría; un id desconocido se ignora', () => {
    expect(eleccionCategoriaDeUrl({ cat: 'sin' }, CATEGORIAS)).toEqual({ categoria: 'sin' });
    expect(eleccionCategoriaDeUrl({ cat: 'nope' }, CATEGORIAS)).toEqual({});
  });
  it('categoria/subcategoria explícitos mandan sobre cat', () => {
    expect(eleccionCategoriaDeUrl({ cat: 'sueldo', categoria: 'comida' }, CATEGORIAS)).toEqual({ categoria: 'comida', subcategoria: undefined });
  });
});

describe('esquema de la URL', () => {
  it('lee y escribe tipo, cat, p y rango sin perder otros parámetros', () => {
    const params = new URLSearchParams('cat=abc&p=30D&tipo=egreso&otro=1&tipo2=x');
    const v = leerFiltros(params, ESQUEMA_REGISTROS);
    expect(v).toMatchObject({ cat: 'abc', p: '30D', tipo: 'egreso' });
    const salida = escribirFiltros(params, ESQUEMA_REGISTROS, { tipo: undefined, desde: '2026-10-01', hasta: '2026-10-31' });
    expect(salida.get('otro')).toBe('1');
    expect(salida.get('tipo')).toBeNull();
    expect(salida.get('desde')).toBe('2026-10-01');
  });
  it('un tipo inválido se descarta', () => {
    expect(leerFiltros(new URLSearchParams('tipo=zzz'), ESQUEMA_REGISTROS).tipo).toBeUndefined();
  });
});

describe('contadores de filtros', () => {
  it('cuenta los filtros avanzados activos (sin período ni búsqueda)', () => {
    expect(contarFiltrosAvanzados({})).toBe(0);
    expect(contarFiltrosAvanzados({ tipo: 'egreso', categoria: 'comida', subcategoria: 'rest', sinanulados: true })).toBe(4);
    expect(contarFiltrosAvanzados({ cat: 'x', subtipo: 'pago' })).toBe(2);
  });
  it('hayFiltrosActivos considera búsqueda, cuentas y avanzados', () => {
    expect(hayFiltrosActivos({ q: '', cuentas: 0, avanzados: 0 })).toBe(false);
    expect(hayFiltrosActivos({ q: 'x', cuentas: 0, avanzados: 0 })).toBe(true);
    expect(hayFiltrosActivos({ q: '', cuentas: 1, avanzados: 0 })).toBe(true);
    expect(hayFiltrosActivos({ q: '', cuentas: 0, avanzados: 2 })).toBe(true);
  });
});
