/** Lógica pura de la sección "Inventario valorizado" de Métricas (sin React; se prueba desde backend/tests).
 *  Todo devuelve datos nuevos y nunca muta la entrada. El valor a costo es kg × costo por kg del producto
 *  (el costo manual manda sobre el promedio de facturas; eso ya viene resuelto en `valorUsd`/`fuente`). */

export type FuenteCostoProducto = 'manual' | 'facturas' | null;

/** Subconjunto de CostoProductoInventario que usa esta sección. */
export interface ProductoValor {
  productoId: string;
  nombre: string;
  categoria: string;
  kg: number;
  costoEfectivoKg: number | null;
  fuente: FuenteCostoProducto;
  valorUsd: number | null;
}

export interface ResumenValor {
  valorUsd: number;
  kgConCosto: number;
  kgSinCosto: number;
  productos: number;
  productosSinCosto: number;
  /** valor ÷ kg con costo; null si ningún kg tiene costo. */
  costoPromedioKg: number | null;
}

const esNumero = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const tieneCosto = (p: ProductoValor): boolean => esNumero(p.valorUsd);
const kgPositivos = (p: ProductoValor): number => (esNumero(p.kg) && p.kg > 0 ? p.kg : 0);

export function resumirValor(productos: readonly ProductoValor[]): ResumenValor {
  let valorUsd = 0;
  let kgConCosto = 0;
  let kgSinCosto = 0;
  let productosSinCosto = 0;
  for (const p of productos) {
    if (tieneCosto(p)) {
      valorUsd += p.valorUsd as number;
      kgConCosto += kgPositivos(p);
    } else {
      kgSinCosto += kgPositivos(p);
      productosSinCosto += 1;
    }
  }
  return {
    valorUsd, kgConCosto, kgSinCosto, productos: productos.length, productosSinCosto,
    costoPromedioKg: kgConCosto > 0 ? valorUsd / kgConCosto : null,
  };
}

export interface FiltroProductos {
  q?: string;
  categoria?: string;
  soloSinCosto?: boolean;
}

const normalizar = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function filtrarProductos(productos: readonly ProductoValor[], f: FiltroProductos): ProductoValor[] {
  const q = f.q ? normalizar(f.q) : '';
  return productos.filter(p => {
    if (f.categoria && p.categoria !== f.categoria) return false;
    if (f.soloSinCosto && tieneCosto(p)) return false;
    if (q && !normalizar(p.nombre).includes(q)) return false;
    return true;
  });
}

/** Categorías distintas, ordenadas alfabéticamente (para el selector). */
export function categoriasDe(productos: readonly ProductoValor[]): string[] {
  return [...new Set(productos.map(p => p.categoria))].sort((a, b) => a.localeCompare(b, 'es'));
}

export interface ValorGrupo { clave: string; etiqueta: string; valorUsd: number; kg: number }

/** Valor a costo por categoría (solo productos con costo), de mayor a menor; `kg` = kg con costo. */
export function valorPorCategoria(productos: readonly ProductoValor[]): ValorGrupo[] {
  const mapa = new Map<string, ValorGrupo>();
  for (const p of productos) {
    if (!tieneCosto(p)) continue;
    const previo = mapa.get(p.categoria) ?? { clave: p.categoria, etiqueta: p.categoria, valorUsd: 0, kg: 0 };
    mapa.set(p.categoria, { ...previo, valorUsd: previo.valorUsd + (p.valorUsd as number), kg: previo.kg + kgPositivos(p) });
  }
  return [...mapa.values()].filter(g => g.valorUsd > 0).sort((a, b) => b.valorUsd - a.valorUsd);
}

/** Los `n` productos que más valen (solo con costo y valor > 0). */
export function topProductosPorValor(productos: readonly ProductoValor[], n = 10): ProductoValor[] {
  return productos
    .filter(p => tieneCosto(p) && (p.valorUsd as number) > 0)
    .sort((a, b) => (b.valorUsd as number) - (a.valorUsd as number))
    .slice(0, n);
}

/** Fila mínima del detalle de la pantalla de inventario. */
export interface FilaAlmacen {
  tipo: 'material' | 'lote';
  productoId: string | null;
  porAlmacen: ReadonlyArray<{ almacenId: string; almacenNombre: string; kg: number }>;
}

export interface ValorAlmacen { almacenId: string; nombre: string; valorUsd: number; kgConCosto: number; kgSinCosto: number }

/** Valor a costo por almacén: kg del producto en ese almacén × costo por kg efectivo del producto.
 *  Solo materiales (los lotes no tienen costo, solo precio estimado de venta). Los kg de productos sin costo
 *  se cuentan aparte (kgSinCosto) y no entran al valor. */
export function valorPorAlmacen(filas: readonly FilaAlmacen[], productos: readonly ProductoValor[]): ValorAlmacen[] {
  const costoPorProducto = new Map<string, number | null>();
  for (const p of productos) costoPorProducto.set(p.productoId, tieneCosto(p) && esNumero(p.costoEfectivoKg) ? p.costoEfectivoKg : null);
  const mapa = new Map<string, ValorAlmacen>();
  for (const f of filas) {
    if (f.tipo !== 'material' || !f.productoId || !costoPorProducto.has(f.productoId)) continue;
    const costo = costoPorProducto.get(f.productoId) ?? null;
    for (const a of f.porAlmacen) {
      if (!(a.kg > 0)) continue;
      const previo = mapa.get(a.almacenId) ?? { almacenId: a.almacenId, nombre: a.almacenNombre, valorUsd: 0, kgConCosto: 0, kgSinCosto: 0 };
      mapa.set(a.almacenId, costo === null
        ? { ...previo, kgSinCosto: previo.kgSinCosto + a.kg }
        : { ...previo, valorUsd: previo.valorUsd + a.kg * costo, kgConCosto: previo.kgConCosto + a.kg });
    }
  }
  return [...mapa.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/** Hay datos suficientes para dibujar una gráfica de barras: al menos 2 grupos con valor. */
export const hayDatosParaGrafica = (valores: readonly number[]): boolean => valores.filter(v => v > 0).length >= 2;

export type EtiquetaFuente = 'Manual' | 'Facturas' | 'Sin costo';
export const etiquetaFuente = (f: FuenteCostoProducto): EtiquetaFuente => (f === 'manual' ? 'Manual' : f === 'facturas' ? 'Facturas' : 'Sin costo');
export const simboloFuente = (f: FuenteCostoProducto): string => (f === 'manual' ? '✎' : f === 'facturas' ? '▤' : '⚠');
