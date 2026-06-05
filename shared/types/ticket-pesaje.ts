export type TipoTicketPesaje = 'compra' | 'venta';

/**
 * Ticket de pesaje — registro de una pesada física de material.
 *
 * `pesoNeto` lo calcula la BD (columna generada): pesoBruto - tara - devolucion,
 * por lo que es de solo lectura desde la app (no se envía al insertar/editar).
 */
export interface TicketPesaje {
  id: string;
  tipo: TipoTicketPesaje;
  /**
   * FK polimórfica: apunta a un proveedor si `tipo === 'compra'`, o a un cliente
   * si `tipo === 'venta'`. No hay FK en BD; la integridad se valida en backend.
   */
  entidadId: string | null;
  /** Material pesado (FK a productos). */
  productoId: string | null;
  /** Nombre del material, resuelto vía join. Solo lectura. */
  nombreProducto?: string | null;
  /** Fecha de la pesada (date ISO: YYYY-MM-DD). */
  fecha: string | null;
  subcategoria: string | null;
  pesoBruto: number | null;
  tara: number | null;
  /** Peso devuelto/descontado. Por defecto 0. */
  devolucion: number;
  /** Calculado en BD (columna generada). Solo lectura. */
  pesoNeto: number | null;
  /** URLs o paths de fotos del material/pesada. */
  fotos: string[] | null;
  observaciones: string | null;
  /** true cuando ya existe una factura (compra o venta) asociada. */
  facturado: boolean;
  /** ISO timestamp (created_at en BD). */
  createdAt: string;
}
