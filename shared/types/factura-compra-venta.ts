/**
 * Facturas de compra y venta del módulo de pesaje.
 *
 * OJO: es un modelo distinto al de `Factura`/`FacturaItem` (factura genérica con
 * varios items y estados 'borrador'|'confirmada'|'anulada'). Estas facturas son
 * de una sola línea, atadas opcionalmente a un ticket de pesaje, y su estado es
 * 'borrador'|'emitida'|'pagada'. Por eso el tipo de estado se llama distinto.
 */
export type EstadoFacturaCompraVenta = 'borrador' | 'emitida' | 'pagada';

/** Una línea de una factura de compra/venta: un material con su peso y precio. */
export interface FacturaLinea {
  id: string;
  /** Material facturado (FK a productos). */
  productoId: string | null;
  /** Nombre del material, resuelto vía join. Solo lectura. */
  nombreProducto?: string | null;
  /** Peso facturado de esta línea (kg). */
  peso: number;
  precioUnitario: number;
  /** peso · precioUnitario. Calculado en BD (columna generada). Solo lectura. */
  subtotal: number;
}

/** Campos comunes a facturas de compra y de venta. */
interface FacturaCompraVentaBase {
  id: string;
  /** Ticket de pesaje del que salen los pesos. Null si fue peso manual. */
  ticketId: string | null;
  /** Líneas de la factura (al menos una). */
  items: FacturaLinea[];
  /** Suma de los subtotales de las líneas. Solo lectura. */
  total: number;
  descripcion: string | null;
  observaciones: string | null;
  estado: EstadoFacturaCompraVenta;
  /** ISO timestamp (created_at en BD). */
  createdAt: string;
}

/** Factura contra un proveedor (la empresa compra material). */
export interface FacturaCompra extends FacturaCompraVentaBase {
  proveedorId: string | null;
  /** Nombre del proveedor, resuelto vía join. Solo lectura. */
  nombreProveedor?: string | null;
  /**
   * Correlativo numérico secuencial, asignado automáticamente por la BD al crear
   * la factura (1, 2, 3, ...). El usuario no lo escribe. Solo lectura.
   */
  numero?: number | null;
  /** Código de control formateado para mostrar: "Compra 0001". Solo lectura. */
  codigo?: string | null;
}

/** Formatea el correlativo de una factura de compra: 1 → "Compra 0001". */
export function formatCodigoCompra(numero: number): string {
  return `Compra ${String(numero).padStart(4, '0')}`;
}

/** Factura contra un cliente (la empresa vende material). */
export interface FacturaVenta extends FacturaCompraVentaBase {
  clienteId: string | null;
  /** Nombre del cliente, resuelto vía join. Solo lectura. */
  nombreCliente?: string | null;
}
