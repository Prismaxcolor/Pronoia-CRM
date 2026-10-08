import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import type { CambiosAuditoria, EntidadAuditable } from '../utils/auditoria.js';

export interface RegistrarAuditoriaInput {
  entidadTipo: EntidadAuditable;
  entidadId: string;
  accion: string;
  usuarioId: string;
  /** Si se omite se busca en users; último recurso, el email del token. */
  usuarioNombre?: string;
  usuarioEmail?: string;
  autorizadoPor?: string | null;
  cambios: CambiosAuditoria;
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
  cambios: CambiosAuditoria;
  createdAt: string;
}

interface AuditoriaRow {
  id: string;
  entidad_tipo: string;
  entidad_id: string;
  accion: string;
  usuario_id: string | null;
  usuario_nombre: string;
  autorizado_por: string | null;
  autorizado_por_nombre: string | null;
  cambios: CambiosAuditoria | null;
  created_at: string;
}

export async function nombreDeUsuario(id: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('users').select('nombre').eq('id', id).maybeSingle();
  return (data?.nombre as string | undefined) ?? null;
}

/**
 * Registra una entrada de auditoría. NUNCA lanza: si la tabla aún no existe
 * (migración sin aplicar) o la BD falla, solo se loguea — la operación de
 * negocio que la invoca no debe fallar por esto. Devuelve false si no quedó
 * registrada, para que quien llama pueda avisar al usuario.
 */
export async function registrarAuditoria(input: RegistrarAuditoriaInput): Promise<boolean> {
  try {
    const usuarioNombre =
      input.usuarioNombre ?? (await nombreDeUsuario(input.usuarioId)) ?? input.usuarioEmail ?? 'desconocido';
    const autorizadoPorNombre = input.autorizadoPor ? await nombreDeUsuario(input.autorizadoPor) : null;

    const { error } = await supabaseAdmin.from('auditoria_ediciones').insert({
      entidad_tipo: input.entidadTipo,
      entidad_id: input.entidadId,
      accion: input.accion,
      usuario_id: input.usuarioId,
      usuario_nombre: usuarioNombre,
      autorizado_por: input.autorizadoPor ?? null,
      autorizado_por_nombre: autorizadoPorNombre,
      cambios: input.cambios,
    });
    if (error) throw new Error(error.message);
    return true;
  } catch (err) {
    logger.error({
      evento: 'auditoria_no_registrada',
      entidadTipo: input.entidadTipo,
      entidadId: input.entidadId,
      accion: input.accion,
      userId: input.usuarioId,
      motivo: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

function toEntrada(row: AuditoriaRow): EntradaAuditoria {
  return {
    id: row.id,
    entidadTipo: row.entidad_tipo,
    entidadId: row.entidad_id,
    accion: row.accion,
    usuarioId: row.usuario_id,
    usuarioNombre: row.usuario_nombre,
    autorizadoPor: row.autorizado_por,
    autorizadoPorNombre: row.autorizado_por_nombre,
    cambios: row.cambios ?? {},
    createdAt: row.created_at,
  };
}

/** Historial de un documento, más reciente primero. Devuelve [] si la tabla no existe. */
export async function listarAuditoria(
  entidadTipo: EntidadAuditable,
  entidadId: string
): Promise<EntradaAuditoria[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('auditoria_ediciones')
      .select('*')
      .eq('entidad_tipo', entidadTipo)
      .eq('entidad_id', entidadId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return ((data ?? []) as AuditoriaRow[]).map(toEntrada);
  } catch (err) {
    logger.warn({
      evento: 'auditoria_no_leida',
      entidadTipo,
      entidadId,
      motivo: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
