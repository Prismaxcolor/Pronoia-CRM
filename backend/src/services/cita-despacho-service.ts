import { supabaseAdmin } from '../config/supabase.js';
import { TABLA_ENTIDAD, type EntidadTelegram } from './telegram-link-service.js';
import type { CrearCitaInput } from '../schemas/citas.js';

export type EstadoCita = 'pendiente' | 'confirmada' | 'reprogramada' | 'cancelada' | 'completada';

/** Horario de despacho: bloques de 1 hora, 8am–4pm. Sencillo a propósito — no hay
 *  configuración de horarios por día en el modelo de datos todavía. */
export const HORARIOS_DISPONIBLES = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'];

const ESTADOS_QUE_OCUPAN_SLOT = ['pendiente', 'confirmada', 'reprogramada'] as const;

export interface CitaPublica {
  id: string;
  entidadTipo: EntidadTelegram;
  entidadId: string;
  fecha: string;
  hora: string;
  estado: EstadoCita;
  notas: string | null;
  createdAt: string;
}

export interface CitaConEntidad extends CitaPublica {
  nombreEntidad: string;
}

interface CitaRow {
  id: string;
  entidad_tipo: EntidadTelegram;
  entidad_id: string;
  fecha: string;
  hora: string;
  estado: EstadoCita;
  notas: string | null;
  created_at: string;
}

function soloHora(hora: string): string {
  return hora.slice(0, 5);
}

function citaToPublica(row: CitaRow): CitaPublica {
  return {
    id: row.id,
    entidadTipo: row.entidad_tipo,
    entidadId: row.entidad_id,
    fecha: row.fecha,
    hora: soloHora(row.hora),
    estado: row.estado,
    notas: row.notas,
    createdAt: row.created_at,
  };
}

export async function obtenerDisponibilidad(fecha: string): Promise<{ hora: string; disponible: boolean }[]> {
  const { data } = await supabaseAdmin
    .from('citas_despacho')
    .select('hora, estado')
    .eq('fecha', fecha)
    .in('estado', ESTADOS_QUE_OCUPAN_SLOT);

  const ocupadas = new Set((data ?? []).map(r => soloHora(r.hora as string)));
  return HORARIOS_DISPONIBLES.map(hora => ({ hora, disponible: !ocupadas.has(hora) }));
}

export async function crearCita(
  entidadTipo: EntidadTelegram,
  entidadId: string,
  input: CrearCitaInput
): Promise<{ cita: CitaPublica } | { error: string }> {
  if (!HORARIOS_DISPONIBLES.includes(input.hora)) {
    return { error: 'Ese horario no está disponible para agendar.' };
  }

  const { data: existentes } = await supabaseAdmin
    .from('citas_despacho')
    .select('id')
    .eq('fecha', input.fecha)
    .eq('hora', input.hora)
    .in('estado', ESTADOS_QUE_OCUPAN_SLOT);

  if (existentes && existentes.length > 0) {
    return { error: 'Ese horario ya fue tomado. Elige otro.' };
  }

  const { data, error } = await supabaseAdmin
    .from('citas_despacho')
    .insert({
      entidad_tipo: entidadTipo,
      entidad_id: entidadId,
      fecha: input.fecha,
      hora: input.hora,
      notas: input.notas ?? null,
    })
    .select('*')
    .single();

  if (error || !data) {
    // 23505 = violación del índice único idx_citas_despacho_slot (Bloque 31):
    // el SELECT de arriba es una verificación de cortesía, no atómica: dos
    // agendamientos simultáneos pueden pasarla ambos. El índice es la
    // garantía real.
    if (error?.code === '23505') return { error: 'Ese horario ya fue tomado. Elige otro.' };
    return { error: error?.message ?? 'No se pudo agendar la cita.' };
  }
  return { cita: citaToPublica(data as CitaRow) };
}

export async function listarCitasEntidad(entidadTipo: EntidadTelegram, entidadId: string): Promise<CitaPublica[]> {
  const { data } = await supabaseAdmin
    .from('citas_despacho')
    .select('*')
    .eq('entidad_tipo', entidadTipo)
    .eq('entidad_id', entidadId)
    .order('fecha', { ascending: false })
    .order('hora', { ascending: false });

  return ((data as CitaRow[] | null) ?? []).map(citaToPublica);
}

/** Vista del staff: todas las citas próximas, con el nombre de la entidad resuelto
 *  (proveedores y clientes son tablas separadas, así que se resuelve en dos pasadas). */
export async function listarCitasStaff(desde?: string, hasta?: string): Promise<CitaConEntidad[]> {
  let q = supabaseAdmin.from('citas_despacho').select('*').order('fecha', { ascending: true }).order('hora', { ascending: true });
  if (desde) q = q.gte('fecha', desde);
  if (hasta) q = q.lte('fecha', hasta);

  const { data } = await q;
  const citas = ((data as CitaRow[] | null) ?? []).map(citaToPublica);
  if (citas.length === 0) return [];

  const idsPorTipo: Record<EntidadTelegram, Set<string>> = { proveedor: new Set(), cliente: new Set() };
  for (const c of citas) idsPorTipo[c.entidadTipo].add(c.entidadId);

  const nombresPorId = new Map<string, string>();
  for (const tipo of ['proveedor', 'cliente'] as const) {
    const ids = [...idsPorTipo[tipo]];
    if (ids.length === 0) continue;
    const { data: entidades } = await supabaseAdmin.from(TABLA_ENTIDAD[tipo]).select('id, nombre').in('id', ids);
    for (const e of (entidades as Array<{ id: string; nombre: string }> | null) ?? []) {
      nombresPorId.set(`${tipo}:${e.id}`, e.nombre);
    }
  }

  return citas.map(c => ({ ...c, nombreEntidad: nombresPorId.get(`${c.entidadTipo}:${c.entidadId}`) ?? '—' }));
}

const ESTADOS_CANCELABLES_POR_ENTIDAD = ['pendiente', 'confirmada'] as const;

/** Cancelación desde el portal (el dueño de la cita) — a diferencia de
 *  actualizarEstadoCita (staff), valida que la cita sea de esta entidad y que
 *  todavía tenga sentido cancelarla. */
export async function cancelarCitaPropia(
  entidadTipo: EntidadTelegram,
  entidadId: string,
  citaId: string
): Promise<CitaPublica | null> {
  const { data, error } = await supabaseAdmin
    .from('citas_despacho')
    .update({ estado: 'cancelada' })
    .eq('id', citaId)
    .eq('entidad_tipo', entidadTipo)
    .eq('entidad_id', entidadId)
    .in('estado', ESTADOS_CANCELABLES_POR_ENTIDAD)
    .select('*')
    .maybeSingle();

  if (error || !data) return null;
  return citaToPublica(data as CitaRow);
}

export async function actualizarEstadoCita(id: string, estado: EstadoCita): Promise<CitaPublica | null> {
  const { data, error } = await supabaseAdmin
    .from('citas_despacho')
    .update({ estado })
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error || !data) return null;
  return citaToPublica(data as CitaRow);
}
