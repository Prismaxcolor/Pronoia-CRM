import { insertarMaestroIdempotente, type MetaOperacion } from './insertar-idempotente.js';
import { supabaseAdmin } from '../config/supabase.js';
import { escribirConReportes } from './grupo-silencio-service.js';
import type { CrearProveedorInput, ActualizarProveedorInput } from '../schemas/proveedores.js';

interface ProveedorRow {
  id: string;
  nombre: string;
  rfc: string | null;
  telefono: string | null;
  email: string | null;
  activo: boolean;
  created_at: string;
  fotos: string[] | null;
  telegram_chat_id: string | null;
  telegram_linked_at: string | null;
  telegram_reportes_activos?: boolean | null;
}

export interface ProveedorPublico {
  id: string;
  nombre: string;
  rfc: string | null;
  telefono: string | null;
  email: string | null;
  activo: boolean;
  createdAt: string;
  fotos: string[];
  telegramChatId: string | null;
  telegramLinkedAt: string | null;
  /** false = el superadmin apagó los avisos de Telegram de los movimientos de este proveedor. */
  telegramReportesActivos: boolean;
}

function toPublico(row: ProveedorRow): ProveedorPublico {
  return {
    id: row.id,
    nombre: row.nombre,
    rfc: row.rfc,
    telefono: row.telefono,
    email: row.email,
    activo: row.activo,
    createdAt: row.created_at,
    fotos: row.fotos ?? [],
    telegramChatId: row.telegram_chat_id,
    telegramLinkedAt: row.telegram_linked_at,
    telegramReportesActivos: row.telegram_reportes_activos !== false,
  };
}

export async function listarProveedores(): Promise<ProveedorPublico[]> {
  const { data, error } = await supabaseAdmin
    .from('proveedores')
    .select('*')
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return (data as ProveedorRow[]).map(toPublico);
}

export async function crearProveedor(
  input: CrearProveedorInput & MetaOperacion
): Promise<{ proveedor: ProveedorPublico } | { error: string }> {
  const { data, error } = await insertarMaestroIdempotente<ProveedorRow>('proveedores', {
    nombre: input.nombre,
    rfc: input.rfc,
    telefono: input.telefono,
    email: input.email,
    fotos: input.fotos ?? [],
  }, { clientRequestId: input.clientRequestId, capturadoEn: input.capturadoEn });

  if (error || !data) return { error: error?.message ?? 'No se pudo crear el proveedor.' };
  return { proveedor: toPublico(data as ProveedorRow) };
}

export async function actualizarProveedor(
  id: string,
  cambios: ActualizarProveedorInput
): Promise<{ proveedor: ProveedorPublico } | { error: string; pendiente?: boolean }> {
  const update: Record<string, unknown> = {};
  if (cambios.nombre !== undefined) update.nombre = cambios.nombre;
  if (cambios.rfc !== undefined) update.rfc = cambios.rfc;
  if (cambios.telefono !== undefined) update.telefono = cambios.telefono;
  if (cambios.email !== undefined) update.email = cambios.email;
  if (cambios.fotos !== undefined) update.fotos = cambios.fotos;
  if (cambios.activo !== undefined) update.activo = cambios.activo;
  if (cambios.telegramReportesActivos !== undefined) update.telegram_reportes_activos = cambios.telegramReportesActivos;

  const r = await escribirConReportes(update, u =>
    supabaseAdmin.from('proveedores').update(u).eq('id', id).select('*').maybeSingle()
  );
  if ('pendiente' in r) return { error: r.mensaje, pendiente: true };
  const { data, error } = r;
  if (error) return { error: error.message };
  if (!data) return { error: 'Proveedor no encontrado.' };
  return { proveedor: toPublico(data as ProveedorRow) };
}

export async function desactivarProveedor(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('proveedores')
    .update({ activo: false })
    .eq('id', id);
  return !error;
}

export async function reactivarProveedor(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('proveedores')
    .update({ activo: true })
    .eq('id', id);
  return !error;
}

export async function borrarProveedor(id: string): Promise<{ ok: boolean; razon?: string }> {
  const { error } = await supabaseAdmin.from('proveedores').delete().eq('id', id);
  if (error) return { ok: false, razon: error.message };
  return { ok: true };
}
