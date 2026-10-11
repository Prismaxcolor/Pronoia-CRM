export type IdiomaPackingList = 'es' | 'en';
export type TipoEmbalajePackingList = 'big_bag' | 'paleta' | 'paquete';
export type ReferenciaPackingList = 'ticket_pesaje' | 'factura_venta';

/**
 * Foto de control interno de una paleta. `ruta` es la ubicación en el bucket PRIVADO; `url` es una URL firmada
 * temporal para mostrarla (null si no se pudo firmar). Nunca va en los PDF.
 */
export interface FotoPaletaPacking {
  ruta: string;
  url: string | null;
}

/** Una fila del packing list: un big bag / paleta / paquete. El neto siempre es bruto − tara de paleta. */
export interface PackingListItem {
  numero: number;
  /** N.º de paleta; en el ejemplo real reinicia en cada lote. */
  numeroPaleta: number | null;
  /** Solo PCB. */
  lote: string | null;
  /** Solo PCB. Clave en inglés del catálogo de colores (ver frontend/src/lib/packing-list.ts). */
  color: string | null;
  pesoBruto: number;
  pesoPaleta: number;
  pesoNeto: number;
  /** Almacén del que se trabaja el lote (CONTROL INTERNO: nunca va en los PDF). Ausente antes de la migración. */
  almacenId?: string | null;
  almacenNombre?: string | null;
  /** Fotos de control interno de la paleta (nunca van en los PDF). Ausente antes de la migración. */
  fotos?: FotoPaletaPacking[];
}

/**
 * Opción del selector de lote del packing list: un lote de exportación en un almacén concreto, con los kg que
 * hay ahora. `disponibleKg` y `almacen*` son de CONTROL INTERNO: se muestran en el editor, nunca en los PDF.
 * `valor` es el texto que se guarda en el ítem (p. ej. "LOTE 1" -> "1", como imprimen los documentos).
 */
export interface OpcionLotePacking {
  loteId: string;
  nombre: string;
  valor: string;
  almacenId: string | null;
  almacenNombre: string | null;
  /** Kg disponibles en ese almacén. null = no se muestra: el usuario no tiene permiso de inventario o no se pudo leer. */
  disponibleKg: number | null;
  /** true = falló la lectura del stock de este lote: no es "0 kg", es un dato desconocido. */
  disponibilidadNoLeida?: boolean;
  /** Clave del color configurado en Inventario (ver COLORES_LOTE); null = sin color predeterminado. */
  colorPredeterminado: string | null;
}

export interface PackingList {
  id: string;
  contenedor: string;
  fecha: string;
  tipoEmbalaje: TipoEmbalajePackingList;
  esPcb: boolean;
  descripcionEs: string | null;
  descripcionEn: string | null;
  observacionesEs: string | null;
  observacionesEn: string | null;
  /** Referencia opcional a un ticket/factura (pendiente de definir con el dueño). */
  referenciaTipo: ReferenciaPackingList | null;
  referenciaId: string | null;
  /** Cliente internacional al que va la exportación (opcional; ausente en datos anteriores a la migración). */
  clienteId?: string | null;
  clienteNombre?: string | null;
  /** Nombre de quien creó el packing list (null si se desconoce). */
  creadoPorNombre?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Versión para control de concurrencia: se envía al editar y sube en cada guardado. */
  version: number;
}

export interface PackingListResumen extends PackingList {
  totalBultos: number;
  totalNeto: number;
}

/**
 * Valoración de un lote incluido en el packing list (proyección de exportación y sus resultados, INTERNA).
 * Los kg no se guardan: se derivan del neto de los ítems del lote. `lote` '' = ítems sin lote.
 */
export interface ProyeccionLotePacking {
  lote: string;
  /** USD por kg estimado, ingresado a mano (null = aún sin estimar). */
  valorKgUsd: number | null;
  /** USD por kg realmente obtenido, ingresado a mano al cerrar la exportación (ausente/null = sin cargar). */
  valorRealKgUsd?: number | null;
}

export interface PackingListDetalle extends PackingList {
  items: PackingListItem[];
  /** Solo viaja a quien tiene facturacion:ver; ausente para el resto. Nunca va en los PDF. */
  proyeccion?: ProyeccionLotePacking[];
}

/** Datos de la empresa que encabeza el documento en cada idioma (es = Venezuela, en = EE.UU.). */
export interface EmpresaPackingList {
  idioma: IdiomaPackingList;
  nombre: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
}

/** Kg netos de un lote dentro de una exportación (derivado de las paletas). `lote` '' = ítems sin lote. */
export interface KgLoteExportacion {
  lote: string;
  kg: number;
}

/**
 * Una exportación es un packing list con cliente internacional vinculado. No tiene datos propios: la
 * valoración vive en la proyección del packing list y el estado se deriva de ella (ver lib/exportaciones.ts).
 */
export interface ExportacionResumen {
  packingListId: string;
  contenedor: string;
  fecha: string;
  clienteId: string;
  clienteNombre: string | null;
  totalNeto: number;
  kgPorLote: KgLoteExportacion[];
  /** Solo viaja a quien tiene facturacion:ver; ausente para el resto. */
  proyeccion?: ProyeccionLotePacking[];
}

export interface ListadoExportaciones {
  exportaciones: ExportacionResumen[];
  /** true = falta aplicar migration_packing_list_cliente_resultados.sql (no hay cliente_id en packing_lists). */
  migracionPendiente?: true;
}
