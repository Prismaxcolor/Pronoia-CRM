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
  /** URLs de fotos de este material — cada material tiene las suyas, en vez
   *  de una sola foto general para todo el ticket (Bloque 46). */
  fotos: string[];
}

/** Una pesada individual que compone el peso global — el camión puede pasar
 *  varias veces por la báscula, cada una con su propia tara y foto. Solo se
 *  carga al crear el ticket, no se edita después (como el peso global mismo). */
export interface PesajeGlobal {
  id: string;
  peso: number;
  tara: number;
  foto: string | null;
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
  /** Mismo valor que pesoNetoTotal, nombre explícito para distinguirlo de la
   *  devolución (que se suma aparte, no está incluida acá). */
  pesoNetoMateriales: number;
  /** Pesaje único de todos los materiales juntos, tomado al llegar el proveedor.
   *  0 cuando pesajeExterior es true (no hay lectura propia de báscula). */
  pesoGlobal: number;
  /** Desglose de pesadas individuales que suman pesoGlobal. */
  pesajesGlobales: PesajeGlobal[];
  /** true si el camión se pesó en una báscula externa a la que Pronoia no tiene acceso. */
  pesajeExterior: boolean;
  /**
   * Kg de devolución del ticket completo (no atada a ningún material). Se
   * suma a pesoNetoMateriales para reconciliar contra pesoGlobal — NO resta
   * del inventario ni de la factura, es solo un campo de conciliación.
   */
  devolucion: number;
  /** URLs de fotos de la devolución del ticket completo (no por material). */
  fotosDevolucion: string[];
  /**
   * pesoGlobal - pesoNetoMateriales - devolucion. Mide la merma/discrepancia
   * entre el pesaje global de entrada y lo que terminó contabilizado por
   * material + devolución. Solo lectura, derivado (no se guarda en BD).
   */
  diferencia: number;
  /** URLs de fotos generales del ticket completo — campo legacy, anterior al
   *  Bloque 46. Ya no se llena desde el formulario (las fotos ahora se
   *  cargan por material, ver TicketPesajeMaterial.fotos), pero se conserva
   *  para no perder las fotos de tickets creados antes de ese cambio. */
  fotos: string[] | null;
  observaciones: string | null;
  /** true cuando ya existe una factura (compra o venta) asociada. */
  facturado: boolean;
  /**
   * 'bruto': se guardó sin materiales/destinos (pendiente de completar). No
   * mueve inventario ni se puede facturar. Solo aplica a compras.
   */
  estado: 'bruto' | 'completo';
  /** Usuario que registró el pesaje (bruto o completo). */
  pesadoPor: string | null;
  /** Usuario que completó un ticket en bruto. Null si nunca fue bruto. */
  completadoPor: string | null;
  /** ISO timestamp de cuándo se completó un ticket en bruto. */
  completadoEn: string | null;
  /** ISO timestamp (created_at en BD). */
  createdAt: string;
}

/** Formatea el correlativo de un ticket de pesaje: (1, 'compra') → "Compra-0001".
 *  Cada tipo tiene su propio contador desde el Bloque 35. */
export function formatCodigoPesaje(numero: number, tipo: 'compra' | 'venta'): string {
  const prefijo = tipo === 'compra' ? 'Compra' : 'Venta';
  return `${prefijo}-${String(numero).padStart(4, '0')}`;
}
