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
  /** Lotes específicos a contar, solo cuando alguna categoría es con lote
   *  (ej. PCB) — null/vacío significa "todos los lotes de ese almacén". */
  loteIds: string[];
  loteNombres: string[];
  estado: EstadoTomaFisica;
  abiertaPor: string;
  abiertaEn: string;
  cerradaPor: string | null;
  cerradaEn: string | null;
  createdAt: string;
}

/** Un pesaje individual de conteo dentro de una toma física — sin destino,
 *  sin pesaje global, sin devolución: solo material + tara + bruto + foto.
 *  En categorías "con lote" (PCB) se pesa el LOTE completo (productoId
 *  null) — un lote mezclado no se puede desarmar material por material al
 *  contarlo físicamente. */
export interface DetalleTomaFisica {
  id: string;
  tomaFisicaId: string;
  productoId: string | null;
  nombreProducto: string | null;
  loteId: string | null;
  nombreLote: string | null;
  pesoBruto: number;
  tara: number;
  pesoNeto: number;
  fotos: string[];
  registradoPor: string;
  createdAt: string;
}

/** Una línea del resumen: stock teórico (sistema) vs. real (contado).
 *  Para categorías sin lote se compara por producto (productoId set,
 *  loteId null). Para categorías con lote (PCB) se compara por LOTE
 *  completo (loteId set, productoId null) — la composición por material
 *  se deriva aparte, ver ComposicionPCBItem. */
export interface ResumenTomaFisicaLinea {
  productoId: string | null;
  productoNombre: string | null;
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
