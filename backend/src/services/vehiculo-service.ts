import { insertarMaestroIdempotente, type MetaOperacion } from './insertar-idempotente.js';
import { supabaseAdmin } from '../config/supabase.js';
import type { CrearVehiculoInput, ActualizarVehiculoInput } from '../schemas/vehiculo.js';

interface VehiculoRow {
  id: string;
  nombre: string;
  placa: string | null;
  marca: string | null;
  modelo: string | null;
  color: string | null;
  conductor: string | null;
  descripcion: string | null;
  fotos: string[] | null;
  activo: boolean;
  created_at: string;
}

export interface VehiculoPublico {
  id: string;
  nombre: string;
  placa: string | null;
  marca: string | null;
  modelo: string | null;
  color: string | null;
  conductor: string | null;
  descripcion: string | null;
  fotos: string[];
  activo: boolean;
  createdAt: string;
}

function toPublico(row: VehiculoRow): VehiculoPublico {
  return {
    id: row.id,
    nombre: row.nombre,
    placa: row.placa,
    marca: row.marca,
    modelo: row.modelo,
    color: row.color,
    conductor: row.conductor,
    descripcion: row.descripcion,
    fotos: row.fotos ?? [],
    activo: row.activo,
    createdAt: row.created_at,
  };
}

/** Traduce el error de índice único (23505) según cuál índice se violó. */
function mensajeDuplicado(mensaje: string): string {
  return mensaje.includes('idx_vehiculos_placa_activa')
    ? 'Ya existe un vehículo activo con esa placa.'
    : 'Ya existe un vehículo con ese nombre.';
}

export async function listarVehiculos(): Promise<VehiculoPublico[]> {
  const { data, error } = await supabaseAdmin
    .from('vehiculos')
    .select('*')
    .order('nombre', { ascending: true });

  if (error || !data) return [];
  return (data as VehiculoRow[]).map(toPublico);
}

export async function crearVehiculo(
  input: CrearVehiculoInput & MetaOperacion
): Promise<{ vehiculo: VehiculoPublico } | { error: string }> {
  const { data, error } = await insertarMaestroIdempotente<VehiculoRow>('vehiculos', {
    nombre: input.nombre,
    placa: input.placa,
    marca: input.marca,
    modelo: input.modelo,
    color: input.color,
    conductor: input.conductor,
    descripcion: input.descripcion,
    fotos: input.fotos ?? [],
  }, { clientRequestId: input.clientRequestId, capturadoEn: input.capturadoEn });

  if (error) {
    if (error.code === '23505') return { error: mensajeDuplicado(error.message) };
    return { error: error.message };
  }
  return { vehiculo: toPublico(data as VehiculoRow) };
}

export async function actualizarVehiculo(
  id: string,
  cambios: ActualizarVehiculoInput
): Promise<{ vehiculo: VehiculoPublico } | { error: string }> {
  // Solo se envían los campos presentes: un PATCH parcial no debe borrar el resto.
  const update: Record<string, unknown> = {};
  for (const campo of ['nombre', 'placa', 'marca', 'modelo', 'color', 'conductor', 'descripcion', 'fotos', 'activo'] as const) {
    if (cambios[campo] !== undefined) update[campo] = cambios[campo];
  }

  const { data, error } = await supabaseAdmin
    .from('vehiculos')
    .update(update)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    if (error.code === '23505') return { error: mensajeDuplicado(error.message) };
    return { error: error.message };
  }
  if (!data) return { error: 'Vehículo no encontrado.' };
  return { vehiculo: toPublico(data as VehiculoRow) };
}

export async function desactivarVehiculo(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from('vehiculos').update({ activo: false }).eq('id', id);
  return !error;
}

/** Falla (con mensaje) si otro vehículo activo ya usa la misma placa. */
export async function reactivarVehiculo(id: string): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabaseAdmin.from('vehiculos').update({ activo: true }).eq('id', id);
  if (error) {
    return { error: error.code === '23505' ? mensajeDuplicado(error.message) : 'No se pudo reactivar el vehículo.' };
  }
  return { ok: true };
}

/** Borra el vehículo del catálogo. Los tickets guardan la placa como texto,
 *  así que no hay referencias que se rompan. */
export async function eliminarVehiculo(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from('vehiculos').delete().eq('id', id);
  return !error;
}
