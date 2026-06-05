/**
 * Lista de precios — modelo cabecera + detalle.
 *
 * Una lista ("Precios Junio") define cuánto se paga por kg de cada material.
 * Al facturar una compra se elige una lista y el sistema jala el precio del
 * material desde sus líneas. Puede haber varias listas activas a la vez
 * (por proveedor, por semana, etc.).
 */

/** Cabecera de una lista de precios. */
export interface ListaPrecios {
  id: string;
  nombre: string;
  /** Fecha desde la que aplica esta lista (date ISO: YYYY-MM-DD). */
  vigenteDesde: string | null;
  activo: boolean;
  /** ISO timestamp (created_at en BD). */
  createdAt: string;
}

/** Precio de un material dentro de una lista (línea de detalle). */
export interface PrecioLista {
  id: string;
  listaId: string;
  productoId: string;
  /** Precio por unidad (kg) del material en esta lista. */
  precio: number;
  /** ISO timestamp (created_at en BD). */
  createdAt: string;
  /** Nombre del producto. Presente cuando viene con join (vista de detalle). */
  nombreProducto?: string;
}
