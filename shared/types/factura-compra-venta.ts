/**
 * Facturas de compra y venta del módulo de pesaje.
 *
 * OJO: es un modelo distinto al de `Factura`/`FacturaItem` (factura genérica con
 * varios items y estados 'borrador'|'confirmada'|'anulada'). Estas facturas son
 * de una sola línea, atadas opcionalmente a un ticket de pesaje, y su estado es
 * 'borrador'|'emitida'|'pagada'. Por eso el tipo de estado se llama distinto.
 */
export type EstadoFacturaCompraVenta = 'borrador' | 'emitida' | 'pagada';

/** Campos comunes a facturas de compra y de venta. */
interface FacturaCompraVentaBase {
  id: string;
  /** Material facturado (FK a productos). */
  productoId: string | null;
  /** Nombre del material, resuelto vía join. Solo lectura. */
  nombreProducto?: string | null;
  /** Ticket de pesaje del que sale el peso. Null si se usa `pesoManual`. */
  ticketId: string | null;
  /** Peso ingresado a mano cuando no hay ticket. */
  pesoManual: number | null;
  /** Peso facturado (neto del ticket o peso manual). Solo lectura. */
  peso?: number;
  /** Precio aplicado desde una lista de precios (opcional). */
  listaPreciosId: string | null;
  precioUnitario: number;
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
}

/** Factura contra un cliente (la empresa vende material). */
export interface FacturaVenta extends FacturaCompraVentaBase {
  clienteId: string | null;
  /** Nombre del cliente, resuelto vía join. Solo lectura. */
  nombreCliente?: string | null;
}
