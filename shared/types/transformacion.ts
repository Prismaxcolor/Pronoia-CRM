/**
 * Transformación de material (Bloque 40): retira kilos de un lote-pool de
 * mezcla (MPP, BGPP, ...) y produce salidas pesadas hacia otros lotes (Lote1,
 * Lote2, Basura, ...). El reparto por producto de lo retirado (composición
 * por promedio ponderado) se calcula al crear y queda fijo en
 * `entradaDetalle` — no cambia aunque la composición del pool siga
 * moviéndose después.
 */
export type EstadoTransformacion = 'bruto' | 'completa';

/** Snapshot del reparto proporcional al retirar — de qué producto original
 *  vino cada porción de lo retirado, según la composición del pool en ese
 *  momento. */
export interface EntradaDetalleTransformacion {
  productoId: string;
  nombreProducto: string;
  pesoKg: number;
}

/** Una salida real, pesada al completar. Sin producto asociado: no se puede
 *  saber con certeza qué producto original representa cada kilo de salida. */
export interface SalidaTransformacion {
  id: string;
  loteDestinoId: string;
  nombreLoteDestino: string;
  pesoBruto: number;
  tara: number;
  pesoNeto: number;
}

export interface Transformacion {
  id: string;
  loteOrigenId: string;
  nombreLoteOrigen: string;
  pesoBruto: number;
  tara: number;
  pesoNeto: number;
  /** Fecha (date ISO: YYYY-MM-DD). */
  fecha: string;
  estado: EstadoTransformacion;
  notas: string | null;
  registradoPor: string | null;
  completadoPor: string | null;
  completadoEn: string | null;
  /** ISO timestamp (created_at en BD). */
  createdAt: string;
  entradaDetalle: EntradaDetalleTransformacion[];
  /** Vacío mientras estado === 'bruto'. */
  salidas: SalidaTransformacion[];
}
