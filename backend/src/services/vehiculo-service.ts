import { supabaseAdmin } from '../config/supabase.js';
import type { CrearVehiculoInput, ActualizarVehiculoInput } from '../schemas/vehiculo.js';

interface VehiculoRow {
  id: string;
  nombre: string;
  activo: boolean;
  created_at: string;
}

export interface VehiculoPublico {
  id: string;
  nombre: string;
  activo: boolean;
  createdAt: string;
}

function toPublico(row: VehiculoRow): VehiculoPublico {
  return {
    id: row.id,
    nombre: row.nombre,
    activo: row.activo,
    createdAt: row.created_at,
  };
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
  input: CrearVehiculoInput
): Promise<{ vehiculo: VehiculoPublico } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('vehiculos')
    .insert({ nombre: input.nombre })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') return { error: 'Ya existe un vehículo con ese nombre/placa.' };
    return { error: error.message };
  }
  return { vehiculo: toPublico(data as VehiculoRow) };
}

export async function actualizarVehiculo(
  id: string,
  cambios: ActualizarVehiculoInput
): Promise<{ vehiculo: VehiculoPublico } | { error: string }> {
  const update: Record<string, unknown> = {};
  if (cambios.nombre !== undefined) update.nombre = cambios.nombre;
  if (cambios.activo !== undefined) update.activo = cambios.activo;

  const { data, error } = await supabaseAdmin
    .from('vehiculos')
    .update(update)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: 'Vehículo no encontrado.' };
  return { vehiculo: toPublico(data as VehiculoRow) };
}

export async function desactivarVehiculo(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from('vehiculos').update({ activo: false }).eq('id', id);
  return !error;
}

export async function reactivarVehiculo(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from('vehiculos').update({ activo: true }).eq('id', id);
  return !error;
}
