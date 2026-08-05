/**
 * Una línea de material dentro de un traslado. `pesoNeto` (lo enviado) lo
 * calcula la BD (columna generada: pesoBruto - tara). `pesoRecibido` queda
 * null hasta que se completa el traslado — lo llena quien recepciona.
 */
export interface TrasladoMaterial {
  id: string;
  productoId: string | null;
  /** Nombre del material, resuelto vía join. Solo lectura. */
  nombreProducto?: string | null;
  subcategoria: string | null;
  pesoBruto: number;
  tara: number;
  /** Calculado en BD (columna generada): pesoBruto - tara. Solo lectura. */
  pesoNeto: number;
  /** Lo que realmente llegó al almacén destino. Null hasta completar. */
  pesoRecibido: number | null;
}

/**
 * Traslado de material entre dos almacenes. Nace 'pendiente' (el material
 * salió del origen) y pasa a 'completo' cuando alguien en el almacén destino
 * confirma cuánto llegó realmente, con foto de evidencia obligatoria.
 */
export interface Traslado {
  id: string;
  /** Correlativo numérico secuencial, asignado por la BD. Solo lectura. */
  numero: number;
  /** Código de control formateado para mostrar: "Traslado-0001". Solo lectura. */
  codigo: string;
  almacenOrigenId: string;
  /** Nombre del almacén de origen, resuelto vía join. Solo lectura. */
  nombreAlmacenOrigen?: string | null;
  almacenDestinoId: string;
  /** Nombre del almacén de destino, resuelto vía join. Solo lectura. */
  nombreAlmacenDestino?: string | null;
  materiales: TrasladoMaterial[];
  /** Suma de los pesos netos enviados de todos los materiales. Solo lectura. */
  pesoNetoEnviado: number;
  /** Suma de lo recibido, null mientras el traslado siga pendiente. */
  pesoNetoRecibido: number | null;
  observaciones: string | null;
  fotos: string[];
  estado: 'pendiente' | 'completo';
  /** Usuario que registró el envío. */
  pesadoPor: string | null;
  /** Usuario que confirmó la recepción. Null mientras esté pendiente. */
  completadoPor: string | null;
  /** ISO timestamp de cuándo se completó. */
  completadoEn: string | null;
  /** ISO timestamp (created_at en BD). */
  createdAt: string;
}

/** Formatea el correlativo de un traslado: 1 → "Traslado-0001". */
export function formatCodigoTraslado(numero: number): string {
  return `Traslado-${String(numero).padStart(4, '0')}`;
}
