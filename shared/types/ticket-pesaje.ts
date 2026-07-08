import type { DestinoTipo } from './lote.js';

export type TipoTicketPesaje = 'compra' | 'venta';

/**
 * Una línea de material dentro de un ticket de pesaje. Un ticket puede tener
 * varias (cada material con su propio peso).
 *
 * `pesoNeto` lo calcula la BD (columna generada): pesoBruto - tara - devolucion,
 * por lo que es de solo lectura desde la app (no se envía al insertar/editar).
 */
export interface TicketPesajeMaterial {
  id: string;
  /** Material pesado (FK a productos). */
  productoId: string | null;
  /** Nombre del material, resuelto vía join. Solo lectura. */
  nombreProducto?: string | null;
  subcategoria: string | null;
  pesoBruto: number;
  tara: number;
  /** Peso devuelto/descontado. Por defecto 0. */
  devolucion: number;
  /** Calculado en BD (columna generada). Solo lectura. */
  pesoNeto: number;
  /** Destino de inventario: 'mpp' o 'lote'. */
  destinoTipo: DestinoTipo;
  /** Lote destino cuando destinoTipo === 'lote'. Null para MPP. */
  loteId: string | null;
  /** Nombre del lote, resuelto vía join. Solo lectura. */
  nombreLote?: string | null;
}

/**
 * Ticket de pesaje — registro de una pesada física, con uno o varios materiales.
 */
export interface TicketPesaje {
  id: string;
  /**
   * Correlativo numérico secuencial, asignado automáticamente por la BD al
   * crear el ticket (1, 2, 3, ...). El usuario no lo escribe. Solo lectura.
   */
  numero: number;
  /** Código de control formateado para mostrar: "Pesaje 0001". Solo lectura. */
  codigo: string;
  tipo: TipoTicketPesaje;
  /**
   * FK polimórfica: apunta a un proveedor si `tipo === 'compra'`, o a un cliente
   * si `tipo === 'venta'`. No hay FK en BD; la integridad se valida en backend.
   */
  entidadId: string | null;
  /** Fecha de la pesada (date ISO: YYYY-MM-DD). */
  fecha: string | null;
  /** Materiales pesados en este ticket (al menos uno). */
  materiales: TicketPesajeMaterial[];
  /** Suma de los pesos netos de todos los materiales. Solo lectura. */
  pesoNetoTotal: number;
  /** Pesaje único de todos los materiales juntos, tomado al llegar el proveedor. */
  pesoGlobal: number;
  /**
   * pesoGlobal - (suma de netos + devolución total). Mide la merma/discrepancia
   * entre el pesaje global de entrada y lo que terminó contabilizado por
   * material. Solo lectura, derivado (no se guarda en BD).
   */
  diferencia: number;
  /** URLs o paths de fotos del material/pesada. */
  fotos: string[] | null;
  observaciones: string | null;
  /** true cuando ya existe una factura (compra o venta) asociada. */
  facturado: boolean;
  /** ISO timestamp (created_at en BD). */
  createdAt: string;
}

/** Formatea el correlativo de un ticket de pesaje: 1 → "Pesaje 0001". */
export function formatCodigoPesaje(numero: number): string {
  return `Pesaje ${String(numero).padStart(4, '0')}`;
}
