export type EstadoTomaFisica = 'abierta' | 'cerrada';

/** Una toma física de inventario: conteo físico periódico de un almacén
 *  que reconcilia el stock teórico del sistema contra lo realmente
 *  contado. Mientras está "abierta", el almacén queda bloqueado para
 *  cualquier movimiento (pesaje, traslados, facturación). */
export interface TomaFisicaInventario {
  id: string;
  /** Correlativo propio, ej. "INV-0001". */
  codigo: string;
  numero: number;
  descripcion: string | null;
  almacenId: string;
  almacenNombre: string | null;
  /** Categorías (tipos_material) incluidas en este conteo. */
  categoriaIds: string[];
  categoriaNombres: string[];
  estado: EstadoTomaFisica;
  abiertaPor: string;
  abiertaEn: string;
  cerradaPor: string | null;
  cerradaEn: string | null;
  createdAt: string;
}

/** Un pesaje individual de conteo dentro de una toma física — sin destino,
 *  sin pesaje global, sin devolución: solo material + tara + bruto + foto. */
export interface DetalleTomaFisica {
  id: string;
  tomaFisicaId: string;
  productoId: string;
  nombreProducto: string;
  loteId: string | null;
  nombreLote: string | null;
  pesoBruto: number;
  tara: number;
  pesoNeto: number;
  fotos: string[];
  registradoPor: string;
  createdAt: string;
}

/** Una línea del resumen: stock teórico (sistema) vs. real (contado) para
 *  un producto (y lote, si la categoría lo requiere). */
export interface ResumenTomaFisicaLinea {
  productoId: string;
  productoNombre: string;
  loteId: string | null;
  loteNombre: string | null;
  stockTeorico: number;
  stockReal: number;
  diferencia: number;
  cantidadPesajes: number;
}

export interface ResumenTomaFisica {
  tomaFisica: TomaFisicaInventario;
  lineas: ResumenTomaFisicaLinea[];
  totalTeorico: number;
  totalReal: number;
  totalDiferencia: number;
}

/** Etiqueta legible del correlativo — "INV-0001". */
export function codigoTomaFisica(numero: number): string {
  return `INV-${String(numero).padStart(4, '0')}`;
}
