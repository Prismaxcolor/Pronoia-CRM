/**
 * Costos de referencia por producto (pantalla de costos de /inventario): lógica pura, sin BD.
 *
 * Costo EFECTIVO de un producto: la referencia manual (productos.costo_referencia_kg) si existe; si no, el
 * promedio ponderado de las facturas de compra; si no hay ninguno, sin costo. La regla vive en
 * combinarCostos (resumen-inventario.ts): aquí solo se presenta por producto con stock.
 */
import type {
  CostoProductoInventario,
  CostosInventario,
} from '../../../shared/types/inventario-pantalla.js';
import { vistaDeCategoria } from './inventario-vistas.js';
import type { ProductoMeta } from './movimientos-pantalla.js';
import type { CostoProducto, InventarioAlmacenEntrada } from './resumen-inventario.js';

const redondear = (n: number, d: number): number => Math.round((n + Number.EPSILON) * 10 ** d) / 10 ** d + 0;
/** Por debajo de esto un stock es ruido de redondeo, no inventario (igual que la pantalla de detalle). */
const UMBRAL_KG = 0.005;

export interface EntradaCostos {
  almacenes: ReadonlyArray<InventarioAlmacenEntrada>;
  productos: ReadonlyArray<Pick<ProductoMeta, 'id' | 'nombre' | 'tipoMaterialId' | 'categoria'>>;
  costos: ReadonlyMap<string, CostoProducto>;
}

/** Stock en galpón por producto sin lote (todos los almacenes). Los lotes no son productos y no se costean aquí. */
function stockPorProducto(almacenes: EntradaCostos['almacenes']) {
  const mapa = new Map<string, { nombre: string; tipoMaterialId: string | null; categoria: string; kg: number }>();
  for (const alm of almacenes) {
    for (const g of alm.grupos) {
      for (const a of g.articulos) {
        if (a.destinoTipo !== 'mpp' || !Number.isFinite(a.stock)) continue;
        const previo = mapa.get(a.productoId);
        mapa.set(a.productoId, {
          nombre: a.nombre, tipoMaterialId: g.tipoMaterialId, categoria: g.nombreCategoria, kg: (previo?.kg ?? 0) + a.stock,
        });
      }
    }
  }
  return mapa;
}

export function construirCostosInventario(e: EntradaCostos): CostosInventario {
  const metas = new Map(e.productos.map(p => [p.id, p]));
  const productos: CostoProductoInventario[] = [];
  for (const [productoId, s] of stockPorProducto(e.almacenes)) {
    if (s.kg <= UMBRAL_KG) continue;
    const costo = e.costos.get(productoId);
    const categoria = metas.get(productoId)?.categoria ?? s.categoria;
    const efectivo = costo ? costo.costoPromedioKg : null;
    productos.push({
      productoId,
      nombre: metas.get(productoId)?.nombre ?? s.nombre,
      categoria,
      categoriaClave: s.tipoMaterialId ?? '__sin__',
      vista: vistaDeCategoria(categoria),
      kg: redondear(s.kg, 3),
      costoFacturasKg: costo?.costoFacturasKg ?? (costo && costo.fuente !== 'manual' ? costo.costoPromedioKg : null),
      costoReferenciaKg: costo?.costoReferenciaKg ?? null,
      costoEfectivoKg: efectivo != null ? redondear(efectivo, 4) : null,
      fuente: costo ? costo.fuente ?? 'facturas' : null,
      valorUsd: efectivo != null ? redondear(s.kg * efectivo, 2) : null,
    });
  }
  productos.sort((a, b) => a.categoria.localeCompare(b.categoria, 'es') || a.nombre.localeCompare(b.nombre, 'es'));
  const conCosto = productos.filter(p => p.valorUsd != null);
  const sinCosto = productos.filter(p => p.valorUsd == null);
  return {
    productos,
    totales: {
      valorUsd: conCosto.length > 0 ? redondear(conCosto.reduce((a, p) => a + (p.valorUsd ?? 0), 0), 2) : null,
      kgSinCosto: redondear(sinCosto.reduce((a, p) => a + p.kg, 0), 3),
      productosSinCosto: sinCosto.length,
    },
  };
}
