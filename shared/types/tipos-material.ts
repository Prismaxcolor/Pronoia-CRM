/**
 * Tipo de material — clasificación del catálogo de materiales que la empresa
 * compra y transforma (ej. cobre, aluminio, cartón). Un producto puede
 * referenciar su tipo de material vía `tipoMaterialId`.
 */
export interface TipoMaterial {
  id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  /** true si los materiales de esta categoría nunca van a un lote específico
   *  al pesarlos — van directo a inventario general (MPP). Ej. "No Ferroso". */
  sinLote: boolean;
  /** true si algún producto de la categoría tiene lotes posibles (anclados):
   *  la toma física la cuenta por lote, no por categoría. Solo lectura. */
  tieneProductosAnclados?: boolean;
  /** ISO timestamp (created_at en BD). */
  createdAt: string;
}
