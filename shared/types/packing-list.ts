export type IdiomaPackingList = 'es' | 'en';
export type TipoEmbalajePackingList = 'big_bag' | 'paleta' | 'paquete';
export type ReferenciaPackingList = 'ticket_pesaje' | 'factura_venta';

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

export interface PackingListDetalle extends PackingList {
  items: PackingListItem[];
}

/** Datos de la empresa que encabeza el documento en cada idioma (es = Venezuela, en = EE.UU.). */
export interface EmpresaPackingList {
  idioma: IdiomaPackingList;
  nombre: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
}
