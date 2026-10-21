export type EstadoTransformacion = 'bruto' | 'completa';
export type CategoriaTransformacion = 'ferroso_no_ferroso' | 'pcb';

export interface EntradaDetalleTransformacion {
  productoId: string;
  nombreProducto: string;
  pesoKg: number;
}

export interface SalidaTransformacion {
  id: string;
  /** Material de la salida. Con loteDestinoId nulo es material suelto (sin lote);
   *  con loteDestinoId es material que entra a ese lote. Nulo en una salida a lote
   *  que hereda la composición de la entrada. */
  productoId: string | null;
  nombreProducto: string | null;
  loteDestinoId: string | null;
  nombreLoteDestino: string | null;
  /** Almacén donde queda este lote resultante (PCB) — puede diferir del
   *  almacén de origen de la transformación y entre salidas distintas. */
  almacenId: string | null;
  nombreAlmacen: string | null;
  pesoBruto: number;
  tara: number;
  pesoNeto: number;
  fotos: string[];
  /** Derivado: material (producto sin lote), lote (lote sin producto) o material_a_lote (ambos). */
  tipoSalida?: 'material' | 'lote' | 'material_a_lote';
  /** Precio por kg de la salida (valoración). Solo en GET /:id; ausente si la migración no está aplicada. */
  precioUnitario?: number | null;
}

/** Un renglón de la merma tipificada de una transformación (basura, plástico, tierra, hierro, otro). */
export interface MermaDetalleTransformacion {
  tipo: 'basura' | 'plastico' | 'tierra' | 'hierro' | 'otro';
  pesoKg: number;
}

export interface Transformacion {
  id: string;
  numero: number | null;
  /** Correlativo legible, ej. "TR-0001". Null si aún no se aplicó la migración. */
  codigo: string | null;
  categoria: CategoriaTransformacion;
  /** Ferroso: producto de entrada (sin lote). */
  productoEntradaId: string | null;
  nombreProductoEntrada: string | null;
  almacenId: string | null;
  /** Legacy: lote-pool de origen (modo anterior). */
  loteOrigenId: string | null;
  nombreLoteOrigen: string | null;
  pesoBruto: number;
  tara: number;
  pesoNeto: number;
  fotosEntrada: string[];
  fecha: string;
  estado: EstadoTransformacion;
  notas: string | null;
  registradoPor: string | null;
  completadoPor: string | null;
  completadoEn: string | null;
  createdAt: string;
  entradaDetalle: EntradaDetalleTransformacion[];
  salidas: SalidaTransformacion[];
  /** Merma por tipo registrada (solo GET /:id; vacío o ausente = todo sin clasificar). */
  mermaDetalle?: MermaDetalleTransformacion[];
  /** Valoración (solo GET /:id). false = migración de valoración sin aplicar en BD. */
  valoracionDisponible?: boolean;
  /** Factura de compra a la que está anclada (opcional). */
  facturaCompraId?: string | null;
  /** Precio de compra por kg del material de entrada (editable). */
  costoUnitario?: number | null;
}

/** Configuración: qué materiales salen habitualmente de un material de entrada. */
export interface SalidaComun {
  id: string;
  productoEntradaId: string;
  productoSalidaId: string;
  nombreProductoSalida: string;
  orden: number;
}
