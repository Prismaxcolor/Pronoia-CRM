import { apiFetch } from './api-client';

export type EntidadAuditable = 'ticket_pesaje' | 'factura_compra' | 'factura_venta' | 'transformacion';

/** Entidades que aceptan llave de edición (espejo de ENTIDADES_CON_LLAVE del backend; las facturas aún no). */
export type EntidadConLlave = 'ticket_pesaje' | 'transformacion';

export interface CambioAuditoria {
  antes: string | number | boolean | null;
  despues: string | number | boolean | null;
}

export interface EntradaAuditoria {
  id: string;
  entidadTipo: string;
  entidadId: string;
  accion: string;
  usuarioId: string | null;
  usuarioNombre: string;
  autorizadoPor: string | null;
  autorizadoPorNombre: string | null;
  cambios: Record<string, CambioAuditoria>;
  createdAt: string;
}

/** Historial de ediciones de un documento, más reciente primero. Si falla
 *  (sin permiso, red, tabla aún no creada) devuelve [] — el historial es
 *  informativo y nunca debe romper la pantalla del documento. */
export async function obtenerHistorialEdiciones(
  entidadTipo: EntidadAuditable,
  entidadId: string
): Promise<EntradaAuditoria[]> {
  try {
    const { entradas } = await apiFetch<{ entradas: EntradaAuditoria[] }>(
      `/api/auditoria/${entidadTipo}/${entidadId}`
    );
    return entradas;
  } catch {
    return [];
  }
}
