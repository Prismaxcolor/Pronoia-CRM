import { describe, it, expect } from 'vitest';
import {
  categoriasDe, etiquetaFuente, filtrarProductos, hayDatosParaGrafica, resumirValor, topProductosPorValor,
  valorPorAlmacen, valorPorCategoria, type ProductoValor,
} from '../../frontend/src/features/metricas/lib/inventario-valor-kpis';

const p = (id: string, nombre: string, categoria: string, kg: number, costo: number | null, fuente: 'manual' | 'facturas' | null = costo === null ? null : 'facturas'): ProductoValor => ({
  productoId: id, nombre, categoria, kg, costoEfectivoKg: costo, fuente, valorUsd: costo === null ? null : kg * costo,
});
const PRODUCTOS = [
  p('a', 'Cobre limpio', 'No ferroso', 100, 5),
  p('b', 'Aluminio', 'No ferroso', 200, 1, 'manual'),
  p('c', 'Chatarra', 'Ferroso', 1000, 0.2),
  p('d', 'Tarjeta mixta', 'PCB', 50, null),
];

describe('resumirValor', () => {
  it('suma valor y kg con costo; los kg sin costo van aparte', () => {
    const r = resumirValor(PRODUCTOS);
    expect(r.valorUsd).toBe(900);
    expect(r.kgConCosto).toBe(1300);
    expect(r.kgSinCosto).toBe(50);
    expect(r.productosSinCosto).toBe(1);
    expect(r.costoPromedioKg).toBeCloseTo(900 / 1300);
  });
  it('sin ningún costo el promedio es null, no 0', () => {
    expect(resumirValor([p('d', 'x', 'PCB', 10, null)]).costoPromedioKg).toBeNull();
    expect(resumirValor([]).valorUsd).toBe(0);
  });
});

describe('filtrarProductos', () => {
  it('filtra por texto sin tildes ni mayúsculas, categoría y solo sin costo', () => {
    expect(filtrarProductos(PRODUCTOS, { q: 'COBRE' }).map(x => x.productoId)).toEqual(['a']);
    expect(filtrarProductos(PRODUCTOS, { categoria: 'Ferroso' }).map(x => x.productoId)).toEqual(['c']);
    expect(filtrarProductos(PRODUCTOS, { soloSinCosto: true }).map(x => x.productoId)).toEqual(['d']);
  });
  it('no muta la entrada y lista categorías únicas', () => {
    const copia = [...PRODUCTOS];
    filtrarProductos(PRODUCTOS, {});
    expect(PRODUCTOS).toEqual(copia);
    expect(categoriasDe(PRODUCTOS)).toEqual(['Ferroso', 'No ferroso', 'PCB']);
  });
});

describe('agrupaciones', () => {
  it('valor por categoría ordenado de mayor a menor y sin categorías sin costo', () => {
    const g = valorPorCategoria(PRODUCTOS);
    expect(g.map(x => [x.etiqueta, x.valorUsd])).toEqual([['No ferroso', 700], ['Ferroso', 200]]);
  });
  it('top por valor', () => {
    expect(topProductosPorValor(PRODUCTOS, 2).map(x => x.productoId)).toEqual(['a', 'b']);
  });
  it('mínimo de datos para graficar', () => {
    expect(hayDatosParaGrafica([10])).toBe(false);
    expect(hayDatosParaGrafica([10, 0])).toBe(false);
    expect(hayDatosParaGrafica([10, 5])).toBe(true);
  });
  it('etiquetas de fuente', () => {
    expect(etiquetaFuente('manual')).toBe('Manual');
    expect(etiquetaFuente(null)).toBe('Sin costo');
  });
});

describe('valorPorAlmacen', () => {
  it('multiplica kg por almacén x costo del producto; ignora lotes y separa kg sin costo', () => {
    const g1 = { almacenId: 'g1', almacenNombre: 'G1' };
    const g2 = { almacenId: 'g2', almacenNombre: 'G2' };
    const r = valorPorAlmacen([
      { tipo: 'material', productoId: 'a', porAlmacen: [{ ...g1, kg: 60 }, { ...g2, kg: 40 }] },
      { tipo: 'material', productoId: 'd', porAlmacen: [{ ...g1, kg: 50 }] },
      { tipo: 'lote', productoId: null, porAlmacen: [{ ...g1, kg: 999 }] },
    ], PRODUCTOS);
    expect(r).toEqual([
      { almacenId: 'g1', nombre: 'G1', valorUsd: 300, kgConCosto: 60, kgSinCosto: 50 },
      { almacenId: 'g2', nombre: 'G2', valorUsd: 200, kgConCosto: 40, kgSinCosto: 0 },
    ]);
  });
});
