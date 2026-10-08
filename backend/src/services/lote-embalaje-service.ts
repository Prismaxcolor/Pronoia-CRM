import { supabaseAdmin } from '../config/supabase.js';
import { leerPaginado } from '../utils/paginacion.js';
import { registrarAuditoria } from './auditoria-service.js';
import { esObjetoInexistente, MENSAJE_INVENTARIO_NO_HABILITADO } from '../utils/migracion-pendiente.js';
import { mensajeDeErrorBd } from '../utils/errores-bd.js';
import { logger } from '../utils/logger.js';
import type { EmbalajeParaResumen } from '../utils/embalaje-lote.js';
import type { MarcarEmbalajeInput } from '../schemas/lote-embalajes.js';

interface EmbalajeRow {
  id: string;
  lote_id: string;
  almacen_id: string | null;
  peso_kg: number | string;
  nota: string | null;
  contenedor: string | null;
  marcado_por: string | null;
  marcado_en: string;
  anulado: boolean;
  anulado_por: string | null;
  anulado_en: string | null;
  anulado_motivo: string | null;
}

export interface EmbalajePublico {
  id: string;
  loteId: string;
  almacenId: string | null;
  pesoKg: number;
  nota: string | null;
  contenedor: string | null;
  marcadoPor: string | null;
  marcadoPorNombre: string | null;
  marcadoEn: string;
  anulado: boolean;
  anuladoPor: string | null;
  anuladoEn: string | null;
  anuladoMotivo: string | null;
}

const COLUMNAS =
  'id, lote_id, almacen_id, peso_kg, nota, contenedor, marcado_por, marcado_en, anulado, anulado_por, anulado_en, anulado_motivo';

function toPublico(r: EmbalajeRow, nombres: ReadonlyMap<string, string>): EmbalajePublico {
  return {
    id: r.id,
    loteId: r.lote_id,
    almacenId: r.almacen_id,
    pesoKg: Number(r.peso_kg),
    nota: r.nota,
    contenedor: r.contenedor,
    marcadoPor: r.marcado_por,
    marcadoPorNombre: r.marcado_por ? nombres.get(r.marcado_por) ?? null : null,
    marcadoEn: r.marcado_en,
    anulado: r.anulado,
    anuladoPor: r.anulado_por,
    anuladoEn: r.anulado_en,
    anuladoMotivo: r.anulado_motivo,
  };
}

export async function nombresDeUsuarios(ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((i): i is string => !!i))];
  if (unicos.length === 0) return new Map();
  try {
    const { data } = await supabaseAdmin.from('users').select('id, nombre').in('id', unicos);
    return new Map(((data ?? []) as Array<{ id: string; nombre: string }>).map(u => [u.id, u.nombre]));
  } catch {
    return new Map();
  }
}

export const MENSAJE_EMBALAJES_NO_LEIDOS = 'No se pudieron leer los embalajes. Intenta de nuevo.';

/** Embalajes VIGENTES (no anulados) de todos los lotes, en una sola lectura paginada.
 *  Tabla aún inexistente (migración pendiente) = []. Cualquier otro fallo de lectura se PROPAGA:
 *  devolver [] aquí haría pasar kilos embalados por "0" sin que nadie se entere. */
export async function cargarEmbalajesVigentes(): Promise<Array<EmbalajeParaResumen & { loteId: string }>> {
  try {
    const filas = await leerPaginado<Pick<EmbalajeRow, 'lote_id' | 'almacen_id' | 'peso_kg'>>((desde, hasta) =>
      supabaseAdmin
        .from('lote_embalajes')
        .select('lote_id, almacen_id, peso_kg')
        .eq('anulado', false)
        .order('marcado_en')
        .order('id')
        .range(desde, hasta)
    );
    return filas.map(f => ({ loteId: f.lote_id, almacenId: f.almacen_id, pesoKg: Number(f.peso_kg), anulado: false }));
  } catch (err) {
    if (esObjetoInexistente(err as { code?: string; message?: string })) return [];
    logger.error({ evento: 'embalajes_no_leidos', motivo: err instanceof Error ? err.message : String(err) });
    throw new Error(MENSAJE_EMBALAJES_NO_LEIDOS);
  }
}

export async function listarEmbalajes(
  loteId: string,
  opts: { incluirAnulados?: boolean } = {}
): Promise<EmbalajePublico[]> {
  let q = supabaseAdmin
    .from('lote_embalajes')
    .select(COLUMNAS)
    .eq('lote_id', loteId)
    .order('marcado_en', { ascending: false })
    .limit(500);
  if (!opts.incluirAnulados) q = q.eq('anulado', false);
  const { data, error } = await q;
  if (error) {
    if (esObjetoInexistente(error)) return [];
    logger.error({ evento: 'embalajes_lote_no_leidos', loteId, motivo: error.message });
    throw new Error(MENSAJE_EMBALAJES_NO_LEIDOS);
  }
  const filas = (data ?? []) as EmbalajeRow[];
  const nombres = await nombresDeUsuarios(filas.flatMap(f => [f.marcado_por, f.anulado_por]));
  return filas.map(f => toPublico(f, nombres));
}

export interface ActorInventario {
  userId: string;
  email?: string;
}

export const ADVERTENCIA_AUDITORIA =
  'La operación se guardó, pero no se pudo registrar en el historial de ediciones. Avisa al administrador.';

export type ResultadoEmbalaje =
  | { ok: true; embalaje: EmbalajePublico; advertencia?: string }
  | { ok: false; error: string; status: 400 | 404 | 409 };

function clasificarError(error: { code?: string; message?: string }): { error: string; status: 400 | 404 | 409 } {
  if (esObjetoInexistente(error)) return { error: MENSAJE_INVENTARIO_NO_HABILITADO, status: 409 };
  const mensaje = mensajeDeErrorBd(error, 'No se pudo completar la operación.');
  // Solo los raise exception de negocio (P0001) llegan con su texto; "no encontrado" => 404.
  if (error.code === 'P0001' && /no encontrad/i.test(mensaje)) return { error: mensaje, status: 404 };
  return { error: mensaje, status: 400 };
}

async function leerEmbalaje(loteId: string, embalajeId: string): Promise<EmbalajePublico | null> {
  const { data } = await supabaseAdmin
    .from('lote_embalajes')
    .select(COLUMNAS)
    .eq('id', embalajeId)
    .eq('lote_id', loteId)
    .maybeSingle();
  if (!data) return null;
  const fila = data as EmbalajeRow;
  return toPublico(fila, await nombresDeUsuarios([fila.marcado_por, fila.anulado_por]));
}

/** Marca N kg del lote como embalados/listos. La validación contra el stock y el lock del lote
 *  ocurren dentro de marcar_lote_embalado (una sola transacción). Todo queda en auditoría. */
export async function marcarEmbalado(
  loteId: string,
  input: MarcarEmbalajeInput,
  actor: ActorInventario
): Promise<ResultadoEmbalaje> {
  const { data: id, error } = await supabaseAdmin.rpc('marcar_lote_embalado', {
    p_lote_id: loteId,
    p_almacen_id: input.almacenId ?? null,
    p_peso_kg: input.pesoKg,
    p_nota: input.nota,
    p_contenedor: input.contenedor,
    p_marcado_por: actor.userId,
  });
  if (error || !id) return { ok: false, ...clasificarError(error ?? { message: 'No se pudo marcar el embalado.' }) };

  const auditada = await registrarAuditoria({
    entidadTipo: 'lote',
    entidadId: loteId,
    accion: 'embalar',
    usuarioId: actor.userId,
    usuarioEmail: actor.email,
    cambios: {
      embalaje_id: { antes: null, despues: String(id) },
      embalado_kg: { antes: null, despues: input.pesoKg },
      ...(input.almacenId ? { almacen_id: { antes: null, despues: input.almacenId } } : {}),
      ...(input.contenedor ? { contenedor: { antes: null, despues: input.contenedor } } : {}),
    },
  });
  const embalaje = await leerEmbalaje(loteId, String(id));
  if (!embalaje) return { ok: false, error: 'El embalaje se guardó pero no se pudo leer de vuelta.', status: 404 };
  return { ok: true, embalaje, ...(auditada ? {} : { advertencia: ADVERTENCIA_AUDITORIA }) };
}

/** Anula un embalaje (no lo borra). Exige motivo; queda en auditoría. */
export async function anularEmbalaje(
  loteId: string,
  embalajeId: string,
  motivo: string,
  actor: ActorInventario
): Promise<ResultadoEmbalaje> {
  const previo = await leerEmbalaje(loteId, embalajeId);
  if (!previo) return { ok: false, error: 'Embalaje no encontrado.', status: 404 };

  const { error } = await supabaseAdmin.rpc('anular_lote_embalaje', {
    p_embalaje_id: embalajeId,
    p_motivo: motivo,
    p_anulado_por: actor.userId,
  });
  if (error) return { ok: false, ...clasificarError(error) };

  const auditada = await registrarAuditoria({
    entidadTipo: 'lote',
    entidadId: loteId,
    accion: 'anular_embalaje',
    usuarioId: actor.userId,
    usuarioEmail: actor.email,
    cambios: {
      embalaje_id: { antes: embalajeId, despues: embalajeId },
      embalado_kg: { antes: previo.pesoKg, despues: null },
      motivo: { antes: null, despues: motivo },
    },
  });
  const embalaje = await leerEmbalaje(loteId, embalajeId);
  if (!embalaje) return { ok: false, error: 'El embalaje se anuló pero no se pudo leer de vuelta.', status: 404 };
  return { ok: true, embalaje, ...(auditada ? {} : { advertencia: ADVERTENCIA_AUDITORIA }) };
}
