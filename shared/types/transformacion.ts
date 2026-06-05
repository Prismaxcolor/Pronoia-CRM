/**
 * Transformación de material: un material de entrada se procesa y produce uno o
 * varios materiales de salida (`detalles`). Entrada y salidas apuntan a
 * `productos` (el catálogo de materiales).
 */
export interface Transformacion {
  id: string;
  /** Fecha de la transformación (date ISO: YYYY-MM-DD). */
  fecha: string | null;
  materialEntradaId: string | null;
  cantidadEntrada: number;
  notas: string | null;
  /** ISO timestamp (created_at en BD). */
  createdAt: string;
  /** Materiales resultantes. Se llena al hacer join con detalle_transformaciones. */
  detalles?: DetalleTransformacion[];
}

/** Una línea de salida de una transformación. */
export interface DetalleTransformacion {
  id: string;
  transformacionId: string;
  materialSalidaId: string | null;
  cantidad: number;
}
