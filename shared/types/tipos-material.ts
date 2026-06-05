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
  /** ISO timestamp (created_at en BD). */
  createdAt: string;
}
