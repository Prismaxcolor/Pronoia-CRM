export type EstadoTransformacion = 'bruto' | 'completa';
export type CategoriaTransformacion = 'ferroso_no_ferroso' | 'pcb';

export interface EntradaDetalleTransformacion {
  productoId: string;
  nombreProducto: string;
  pesoKg: number;
}

export interface SalidaTransformacion {
  id: string;
  /** Solo para transformaciones ferroso (sin lote). */
  productoId: string | null;
  nombreProducto: string | null;
  loteDestinoId: string | null;
  nombreLoteDestino: string | null;
  pesoBruto: number;
  tara: number;
  pesoNeto: number;
  fotos: string[];
}

export interface Transformacion {
  id: string;
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
}

/** Configuración: qué materiales salen habitualmente de un material de entrada. */
export interface SalidaComun {
  id: string;
  productoEntradaId: string;
  productoSalidaId: string;
  nombreProductoSalida: string;
  orden: number;
}
