/** Lógica pura de las pantallas de Productos y Listas de precios (indicadores, filtros y datos de gráficas).
 *  Sin React ni DOM: se prueba desde backend/tests/productos-kpis.test.ts. Todo devuelve valores NUEVOS (nunca muta la entrada).
 *  No calcula precios ni listas: solo cuenta y agrupa lo que ya entrega la API. */

import type { Producto, TipoProducto } from '../../../shared/types/producto';
import type { ListaPrecios, PrecioLista } from '../../../shared/types/lista-precios';
import { admiteEstadoLimpieza } from '../features/productos/estado-limpieza';
import { colorCategoria } from './colores-categoria';
import type { ItemDona } from './graficas';

export const SIN_CATEGORIA = 'Sin categoría';

/** Campos del producto que usa esta lógica (Producto cumple de sobra). */
export type ProductoResumen = Pick<Producto, 'nombre' | 'descripcion' | 'activo' | 'tipo'> & {
  tipoMaterialNombre?: string | null;
  loteIds?: string[];
  estadoLimpieza?: 'limpio' | 'sucio' | null;
};

export const categoriaDeProducto = (p: Pick<ProductoResumen, 'tipoMaterialNombre'>): string => p.tipoMaterialNombre ?? SIN_CATEGORIA;

/** Un producto "tiene lote ancla" cuando tiene al menos un lote posible (producto_lotes): en el pesaje esos lotes se ofrecen primero. */
export const tieneLoteAncla = (p: Pick<ProductoResumen, 'loteIds'>): boolean => (p.loteIds?.length ?? 0) > 0;

/** Ferroso / No ferroso activo cuyo estado limpio/sucio aún no se definió. */
export const faltaEstadoLimpieza = (p: ProductoResumen): boolean =>
  p.activo && admiteEstadoLimpieza(p.tipoMaterialNombre) && !p.estadoLimpieza;

// ---------------------------------------------------------------- filtros

export type FiltroActivo = 'activos' | 'inactivos';
export const TIPOS_PRODUCTO: readonly TipoProducto[] = ['amarillo', 'azul', 'verde'];

export interface FiltrosProductos {
  q?: string;
  categoria?: string;
  activo?: FiltroActivo;
  tipo?: TipoProducto;
  sinEstado?: boolean;
}

export function filtrarProductos<T extends ProductoResumen>(productos: readonly T[], f: FiltrosProductos): T[] {
  const q = (f.q ?? '').trim().toLowerCase();
  return productos.filter(p => {
    const cat = categoriaDeProducto(p);
    if (f.sinEstado && !faltaEstadoLimpieza(p)) return false;
    if (f.tipo && p.tipo !== f.tipo) return false;
    if (f.categoria && cat !== f.categoria) return false;
    if (f.activo === 'activos' && !p.activo) return false;
    if (f.activo === 'inactivos' && p.activo) return false;
    if (!q) return true;
    return p.nombre.toLowerCase().includes(q) || p.descripcion.toLowerCase().includes(q) || cat.toLowerCase().includes(q);
  });
}

/** Categorías presentes, ordenadas (para el selector de filtro). */
export function categoriasPresentes(productos: readonly ProductoResumen[]): string[] {
  return Array.from(new Set(productos.map(categoriaDeProducto))).sort((a, b) => a.localeCompare(b, 'es'));
}

// ---------------------------------------------------------------- indicadores

export interface CategoriaConteo { nombre: string; cantidad: number; pct: number }

export interface KpisProductos {
  total: number;
  activos: number;
  inactivos: number;
  conLoteAncla: number;
  /** % del total con lote ancla (null si no hay productos). */
  pctConLoteAncla: number | null;
  sinEstado: number;
  /** Cantidad de productos por categoría, de mayor a menor (empate: por nombre). */
  porCategoria: CategoriaConteo[];
}

export function derivarKpisProductos(productos: readonly ProductoResumen[]): KpisProductos {
  const total = productos.length;
  const activos = productos.filter(p => p.activo).length;
  const conLoteAncla = productos.filter(tieneLoteAncla).length;
  const conteo = new Map<string, number>();
  for (const p of productos) {
    const c = categoriaDeProducto(p);
    conteo.set(c, (conteo.get(c) ?? 0) + 1);
  }
  const porCategoria = Array.from(conteo, ([nombre, cantidad]) => ({ nombre, cantidad, pct: total > 0 ? (cantidad / total) * 100 : 0 }))
    .sort((a, b) => b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre, 'es'));
  return {
    total,
    activos,
    inactivos: total - activos,
    conLoteAncla,
    pctConLoteAncla: total > 0 ? (conLoteAncla / total) * 100 : null,
    sinEstado: productos.filter(faltaEstadoLimpieza).length,
    porCategoria,
  };
}

/** Partes de la dona de categorías, con el color fijo de cada categoría (la dona agrupa en "Otros" lo que pase de 5). */
export function itemsDonaCategorias(porCategoria: readonly CategoriaConteo[]): ItemDona[] {
  return porCategoria.map(c => ({ etiqueta: c.nombre, valor: c.cantidad, color: colorCategoria(c.nombre) }));
}

// ---------------------------------------------------------------- listas de precios

export interface KpisListas {
  total: number;
  compra: number;
  venta: number;
  activas: number;
  inactivas: number;
  /** Fecha ISO (YYYY-MM-DD) de la vigencia más reciente declarada, o null si ninguna lista tiene. */
  ultimaVigencia: string | null;
}

export function derivarKpisListas(listas: readonly ListaPrecios[]): KpisListas {
  const vigencias = listas.map(l => l.vigenteDesde).filter((v): v is string => Boolean(v)).sort();
  const activas = listas.filter(l => l.activo).length;
  return {
    total: listas.length,
    compra: listas.filter(l => l.tipo === 'compra').length,
    venta: listas.filter(l => l.tipo === 'venta').length,
    activas,
    inactivas: listas.length - activas,
    ultimaVigencia: vigencias.length > 0 ? vigencias[vigencias.length - 1] : null,
  };
}

export interface KpisPreciosLista {
  conPrecio: number;
  /** Productos activos del catálogo que aún no tienen precio en esta lista. */
  activosSinPrecio: number;
  /** Precio más bajo / más alto / promedio simple (USD por kg); null si no hay precios. */
  minimo: number | null;
  maximo: number | null;
  promedio: number | null;
  /** ISO del precio cargado más recientemente (created_at), o null. */
  ultimoPrecioCargado: string | null;
}

export function derivarKpisPreciosLista(
  precios: readonly Pick<PrecioLista, 'productoId' | 'precio' | 'createdAt'>[],
  productos: readonly Pick<Producto, 'id' | 'activo'>[],
): KpisPreciosLista {
  const conPrecio = new Set(precios.map(p => p.productoId));
  const valores = precios.map(p => p.precio).filter(Number.isFinite);
  const fechas = precios.map(p => p.createdAt).filter(Boolean).sort();
  return {
    conPrecio: precios.length,
    activosSinPrecio: productos.filter(p => p.activo && !conPrecio.has(p.id)).length,
    minimo: valores.length > 0 ? Math.min(...valores) : null,
    maximo: valores.length > 0 ? Math.max(...valores) : null,
    promedio: valores.length > 0 ? valores.reduce((s, v) => s + v, 0) / valores.length : null,
    ultimoPrecioCargado: fechas.length > 0 ? fechas[fechas.length - 1] : null,
  };
}
