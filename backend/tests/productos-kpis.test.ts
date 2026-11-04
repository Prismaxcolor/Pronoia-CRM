import { describe, it, expect } from 'vitest';
import {
  SIN_CATEGORIA,
  categoriasPresentes,
  derivarKpisListas,
  derivarKpisPreciosLista,
  derivarKpisProductos,
  faltaEstadoLimpieza,
  filtrarProductos,
  itemsDonaCategorias,
  tieneLoteAncla,
  type ProductoResumen,
} from '../../frontend/src/lib/productos-kpis';
import { colorCategoria } from '../../frontend/src/lib/colores-categoria';
import { porcionesDona } from '../../frontend/src/lib/graficas';
import type { ListaPrecios } from '../../shared/types/lista-precios';

const prod = (o: Partial<ProductoResumen> & { nombre: string }): ProductoResumen => ({
  descripcion: '', activo: true, tipo: 'amarillo', tipoMaterialNombre: 'PCB', loteIds: [], estadoLimpieza: null, ...o,
});

const CATALOGO: ProductoResumen[] = [
  prod({ nombre: 'Placa verde', tipoMaterialNombre: 'PCB', loteIds: ['l1'] }),
  prod({ nombre: 'Placa mixta', tipoMaterialNombre: 'PCB' }),
  prod({ nombre: 'Hierro pesado', tipoMaterialNombre: 'Ferroso' }),
  prod({ nombre: 'Hierro limpio', tipoMaterialNombre: 'Ferroso', estadoLimpieza: 'limpio', tipo: 'azul' }),
  prod({ nombre: 'Cobre', tipoMaterialNombre: 'No ferroso', activo: false, loteIds: ['l1', 'l2'] }),
  prod({ nombre: 'Suelto', tipoMaterialNombre: null }),
];

describe('derivarKpisProductos', () => {
  it('cuenta total, activos, inactivos, lote ancla y pendientes de estado', () => {
    const k = derivarKpisProductos(CATALOGO);
    expect(k.total).toBe(6);
    expect(k.activos).toBe(5);
    expect(k.inactivos).toBe(1);
    expect(k.conLoteAncla).toBe(2);
    expect(k.pctConLoteAncla).toBeCloseTo(33.33, 1);
    expect(k.sinEstado).toBe(1);
  });

  it('agrupa por categoría de mayor a menor y usa "Sin categoría" cuando falta', () => {
    const k = derivarKpisProductos(CATALOGO);
    // Empate Ferroso/PCB (2 y 2): desempata por nombre.
    expect(k.porCategoria[0]).toMatchObject({ nombre: 'Ferroso', cantidad: 2 });
    expect(k.porCategoria[1]).toMatchObject({ nombre: 'PCB', cantidad: 2 });
    expect(k.porCategoria.find(c => c.nombre === SIN_CATEGORIA)?.cantidad).toBe(1);
    expect(k.porCategoria.reduce((s, c) => s + c.pct, 0)).toBeCloseTo(100, 5);
  });

  it('catálogo vacío: ceros y porcentaje desconocido (no 0 engañoso)', () => {
    const k = derivarKpisProductos([]);
    expect(k.total).toBe(0);
    expect(k.pctConLoteAncla).toBeNull();
    expect(k.porCategoria).toEqual([]);
  });

  it('no muta la entrada', () => {
    const copia = JSON.stringify(CATALOGO);
    derivarKpisProductos(CATALOGO);
    expect(JSON.stringify(CATALOGO)).toBe(copia);
  });
});

describe('tieneLoteAncla y faltaEstadoLimpieza', () => {
  it('lote ancla = al menos un lote posible', () => {
    expect(tieneLoteAncla({ loteIds: ['a'] })).toBe(true);
    expect(tieneLoteAncla({ loteIds: [] })).toBe(false);
    expect(tieneLoteAncla({})).toBe(false);
  });

  it('solo Ferroso/No ferroso activos sin estado faltan', () => {
    expect(faltaEstadoLimpieza(prod({ nombre: 'a', tipoMaterialNombre: 'Ferroso' }))).toBe(true);
    expect(faltaEstadoLimpieza(prod({ nombre: 'a', tipoMaterialNombre: 'No ferroso', activo: false }))).toBe(false);
    expect(faltaEstadoLimpieza(prod({ nombre: 'a', tipoMaterialNombre: 'PCB' }))).toBe(false);
    expect(faltaEstadoLimpieza(prod({ nombre: 'a', tipoMaterialNombre: 'Ferroso', estadoLimpieza: 'sucio' }))).toBe(false);
  });
});

describe('filtrarProductos', () => {
  it('sin filtros devuelve todo', () => expect(filtrarProductos(CATALOGO, {})).toHaveLength(6));
  it('filtra por categoría', () => expect(filtrarProductos(CATALOGO, { categoria: 'PCB' })).toHaveLength(2));
  it('filtra por activo / inactivo', () => {
    expect(filtrarProductos(CATALOGO, { activo: 'inactivos' }).map(p => p.nombre)).toEqual(['Cobre']);
    expect(filtrarProductos(CATALOGO, { activo: 'activos' })).toHaveLength(5);
  });
  it('busca sin distinguir mayúsculas en nombre, descripción y categoría', () => {
    expect(filtrarProductos(CATALOGO, { q: ' HIERRO ' })).toHaveLength(2);
    expect(filtrarProductos(CATALOGO, { q: 'no ferroso' })).toHaveLength(1);
    expect(filtrarProductos(CATALOGO, { q: 'sin categ' })).toHaveLength(1);
  });
  it('combina tipo y sinEstado', () => {
    expect(filtrarProductos(CATALOGO, { tipo: 'azul' })).toHaveLength(1);
    expect(filtrarProductos(CATALOGO, { sinEstado: true }).map(p => p.nombre)).toEqual(['Hierro pesado']);
  });
  it('lista las categorías ordenadas', () => {
    expect(categoriasPresentes(CATALOGO)).toEqual(['Ferroso', 'No ferroso', 'PCB', SIN_CATEGORIA]);
  });
});

describe('itemsDonaCategorias', () => {
  it('usa los colores fijos de categoría y la dona agrupa en Otros pasadas 5 partes', () => {
    const muchas = ['PCB', 'PGM', 'RAEE', 'Ferroso', 'No ferroso', 'Basura', 'Procesadores']
      .map((n, i) => prod({ nombre: `p${i}`, tipoMaterialNombre: n }));
    const items = itemsDonaCategorias(derivarKpisProductos(muchas).porCategoria);
    expect(items.find(i => i.etiqueta === 'PCB')?.color).toBe(colorCategoria('PCB'));
    const porciones = porcionesDona(items);
    expect(porciones).toHaveLength(6);
    expect(porciones[5].etiqueta).toBe('Otros');
  });
});

const lista = (o: Partial<ListaPrecios>): ListaPrecios => ({
  id: 'x', nombre: 'L', tipo: 'compra', vigenteDesde: null, activo: true, createdAt: '2026-09-01T00:00:00Z', ...o,
});

describe('derivarKpisListas', () => {
  it('cuenta por tipo y estado y toma la vigencia más reciente', () => {
    const k = derivarKpisListas([
      lista({ vigenteDesde: '2026-09-10' }),
      lista({ tipo: 'venta', vigenteDesde: '2026-10-01', activo: false }),
      lista({ tipo: 'venta' }),
    ]);
    expect(k).toMatchObject({ total: 3, compra: 1, venta: 2, activas: 2, inactivas: 1, ultimaVigencia: '2026-10-01' });
  });
  it('sin listas: vigencia nula', () => expect(derivarKpisListas([]).ultimaVigencia).toBeNull());
});

describe('derivarKpisPreciosLista', () => {
  const precios = [
    { productoId: 'a', precio: 2, createdAt: '2026-09-01T10:00:00Z' },
    { productoId: 'b', precio: 4, createdAt: '2026-09-20T10:00:00Z' },
  ];
  it('resume precios y productos activos sin precio', () => {
    const k = derivarKpisPreciosLista(precios, [
      { id: 'a', activo: true }, { id: 'b', activo: true }, { id: 'c', activo: true }, { id: 'd', activo: false },
    ]);
    expect(k).toMatchObject({ conPrecio: 2, activosSinPrecio: 1, minimo: 2, maximo: 4, promedio: 3, ultimoPrecioCargado: '2026-09-20T10:00:00Z' });
  });
  it('sin precios: valores nulos', () => {
    const k = derivarKpisPreciosLista([], [{ id: 'a', activo: true }]);
    expect(k).toMatchObject({ conPrecio: 0, activosSinPrecio: 1, minimo: null, maximo: null, promedio: null, ultimoPrecioCargado: null });
  });
});
