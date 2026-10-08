// Desglose del inventario de UN almacén: relaciona compras, ventas, traslados
// (entrada/salida), transformaciones (consumo/producción) y ajustes de toma
// física por producto (material sin lote) o por lote. Función pura, sin BD.
//
// Misma aritmética que stock_almacen() / stock_lote_por_almacen() en SQL:
//   stock = compras − ventas + traslado_entrada − traslado_salida
//           − transf_entrada (material consumido) + transf_salida (producido)
//           ± ajustes

export type TipoMovimientoAlmacen =
  | 'compra'
  | 'venta'
  | 'traslado_entrada'
  | 'traslado_salida'
  | 'transf_entrada'
  | 'transf_salida'
  | 'ajuste';

/** Un movimiento ya atribuido a este almacén. `peso` es siempre positivo salvo
 *  en 'ajuste', donde viene con signo (sobrante +, faltante −). */
export interface MovimientoAlmacen {
  tipo: TipoMovimientoAlmacen;
  productoId: string | null;
  loteId: string | null;
  peso: number;
}

export interface LineaDesgloseAlmacen {
  /** Producto cuando la línea es material sin lote; null cuando es un lote. */
  productoId: string | null;
  loteId: string | null;
  compras: number;
  ventas: number;
  trasladoEntrada: number;
  trasladoSalida: number;
  /** Material consumido por transformaciones (resta). */
  transfEntrada: number;
  /** Material producido por transformaciones (suma). */
  transfSalida: number;
  ajustes: number;
  stock: number;
}

function lineaVacia(productoId: string | null, loteId: string | null): LineaDesgloseAlmacen {
  return {
    productoId, loteId,
    compras: 0, ventas: 0, trasladoEntrada: 0, trasladoSalida: 0,
    transfEntrada: 0, transfSalida: 0, ajustes: 0, stock: 0,
  };
}

/** Un lote es una sola línea (sus movimientos no siempre traen producto);
 *  el material sin lote es una línea por producto. */
function claveLinea(m: MovimientoAlmacen): string | null {
  if (m.loteId) return `lote:${m.loteId}`;
  if (m.productoId) return `producto:${m.productoId}`;
  return null;
}

function stockDeLinea(l: LineaDesgloseAlmacen): number {
  return l.compras - l.ventas + l.trasladoEntrada - l.trasladoSalida - l.transfEntrada + l.transfSalida + l.ajustes;
}

export function calcularDesgloseAlmacen(movimientos: readonly MovimientoAlmacen[]): LineaDesgloseAlmacen[] {
  const lineas = new Map<string, LineaDesgloseAlmacen>();

  for (const m of movimientos) {
    const clave = claveLinea(m);
    if (!clave || !Number.isFinite(m.peso)) continue;
    let linea = lineas.get(clave);
    if (!linea) {
      linea = m.loteId ? lineaVacia(null, m.loteId) : lineaVacia(m.productoId, null);
      lineas.set(clave, linea);
    }
    switch (m.tipo) {
      case 'compra': linea.compras += m.peso; break;
      case 'venta': linea.ventas += m.peso; break;
      case 'traslado_entrada': linea.trasladoEntrada += m.peso; break;
      case 'traslado_salida': linea.trasladoSalida += m.peso; break;
      case 'transf_entrada': linea.transfEntrada += m.peso; break;
      case 'transf_salida': linea.transfSalida += m.peso; break;
      case 'ajuste': linea.ajustes += m.peso; break;
    }
  }

  return Array.from(lineas.values()).map(l => ({ ...l, stock: stockDeLinea(l) }));
}
