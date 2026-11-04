import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import type { EntidadAuditable } from '../utils/auditoria.js';

/** Quién y cuándo (instante ISO) hizo algo sobre un documento. */
export interface AutoriaEdicion {
  nombre: string;
  en: string;
}

/** Acciones de auditoría que cuentan como "edición" del documento (no valoraciones ni embalajes). */
const ACCIONES_EDICION = ['editar', 'edicion', 'edicion_merma'];

/** Nombres de usuario por id en una sola consulta. Falla en silencio (devuelve lo que haya): es dato de presentación. */
export async function nombresDeUsuarios(ids: ReadonlyArray<string | null | undefined>): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((x): x is string => !!x))];
  if (unicos.length === 0) return new Map();
  const { data, error } = await supabaseAdmin.from('users').select('id, nombre').in('id', unicos);
  if (error) {
    logger.warn({ evento: 'autoria_nombres_no_resueltos', motivo: error.message });
    return new Map();
  }
  return new Map(((data ?? []) as Array<{ id: string; nombre: string | null }>).filter(u => u.nombre).map(u => [u.id, u.nombre as string]));
}

/** Última edición registrada en la auditoría del documento; null si nunca se editó o la auditoría no está disponible. */
export async function ultimaEdicionDe(entidadTipo: EntidadAuditable, entidadId: string): Promise<AutoriaEdicion | null> {
  const { data, error } = await supabaseAdmin
    .from('auditoria_ediciones')
    .select('usuario_nombre, created_at')
    .eq('entidad_tipo', entidadTipo)
    .eq('entidad_id', entidadId)
    .in('accion', ACCIONES_EDICION)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) {
    logger.warn({ evento: 'autoria_ultima_edicion_no_disponible', entidadTipo, motivo: error.message });
    return null;
  }
  const fila = (data ?? [])[0] as { usuario_nombre: string | null; created_at: string } | undefined;
  return fila ? { nombre: fila.usuario_nombre ?? '—', en: fila.created_at } : null;
}
