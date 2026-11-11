import { insertarMaestroIdempotente, type MetaOperacion } from './insertar-idempotente.js';
import { supabaseAdmin } from '../config/supabase.js';
import { escribirConReportes } from './grupo-silencio-service.js';
import { esColumnaInexistente } from '../utils/migracion-pendiente.js';
import type { TipoVentaCliente, CrearClienteInput, ActualizarClienteInput } from '../schemas/clientes.js';

interface ClienteRow {
  id: string;
  nombre: string;
  identificacion: string | null;
  email: string | null;
  telefono: string | null;
  direccion: string | null;
  notas: string | null;
  activo: boolean;
  creado_por: string | null;
  creado_en: string;
  fotos: string[] | null;
  telegram_chat_id: string | null;
  telegram_linked_at: string | null;
  tipo_venta: TipoVentaCliente | null;
  telegram_reportes_activos?: boolean | null;
  /** Ausente mientras no se aplique docs/migration_terceros_imagen.sql. */
  imagen_url?: string | null;
}

export const MENSAJE_IMAGEN_CLIENTE_PENDIENTE =
  'La imagen del cliente aún no está habilitada en la base de datos (falta aplicar migration_terceros_imagen.sql). Guarda sin imagen o aplica la migración.';

export interface ClientePublico {
  id: string;
  nombre: string;
  identificacion: string | null;
  email: string | null;
  telefono: string | null;
  direccion: string | null;
  notas: string | null;
  activo: boolean;
  creadoPor: string;
  creadoEn: string;
  fotos: string[];
  telegramChatId: string | null;
  telegramLinkedAt: string | null;
  tipoVenta: TipoVentaCliente;
  /** false = el superadmin apagó los avisos de Telegram de los movimientos de este cliente. */
  telegramReportesActivos: boolean;
  /** URL pública de la imagen junto al nombre; null si no tiene (o la migración aún no se aplicó). */
  imagenUrl: string | null;
}

function toPublico(row: ClienteRow): ClientePublico {
  return {
    id: row.id,
    nombre: row.nombre,
    identificacion: row.identificacion,
    email: row.email,
    telefono: row.telefono,
    direccion: row.direccion,
    notas: row.notas,
    activo: row.activo,
    creadoPor: row.creado_por ?? '',
    creadoEn: row.creado_en,
    fotos: row.fotos ?? [],
    telegramChatId: row.telegram_chat_id,
    telegramLinkedAt: row.telegram_linked_at,
    tipoVenta: row.tipo_venta ?? 'nacional',
    telegramReportesActivos: row.telegram_reportes_activos !== false,
    imagenUrl: row.imagen_url ? row.imagen_url : null,
  };
}

export async function listarClientes(): Promise<ClientePublico[]> {
  const { data, error } = await supabaseAdmin
    .from('clientes')
    .select('*')
    .order('creado_en', { ascending: false });

  if (error || !data) return [];
  return (data as ClienteRow[]).map(toPublico);
}

export async function crearCliente(
  input: CrearClienteInput & MetaOperacion,
  creadoPor: string
): Promise<{ cliente: ClientePublico } | { error: string }> {
  const { data, error } = await insertarMaestroIdempotente<ClienteRow>('clientes', {
    nombre: input.nombre,
    identificacion: input.identificacion,
    email: input.email,
    telefono: input.telefono,
    direccion: input.direccion,
    notas: input.notas,
    fotos: input.fotos ?? [],
    tipo_venta: input.tipoVenta,
    creado_por: creadoPor,
    // Solo si viene: sin imagen el alta no depende de la columna de imagen.
    ...(input.imagenUrl ? { imagen_url: input.imagenUrl } : {}),
  }, { clientRequestId: input.clientRequestId, capturadoEn: input.capturadoEn });

  if (esColumnaInexistente(error, 'imagen_url')) return { error: MENSAJE_IMAGEN_CLIENTE_PENDIENTE };
  if (error || !data) return { error: error?.message ?? 'No se pudo crear el cliente.' };
  return { cliente: toPublico(data as ClienteRow) };
}

export async function actualizarCliente(
  id: string,
  cambios: ActualizarClienteInput
): Promise<{ cliente: ClientePublico } | { error: string; pendiente?: boolean }> {
  const update: Record<string, unknown> = {};
  if (cambios.nombre !== undefined) update.nombre = cambios.nombre;
  if (cambios.identificacion !== undefined) update.identificacion = cambios.identificacion;
  if (cambios.email !== undefined) update.email = cambios.email;
  if (cambios.telefono !== undefined) update.telefono = cambios.telefono;
  if (cambios.direccion !== undefined) update.direccion = cambios.direccion;
  if (cambios.notas !== undefined) update.notas = cambios.notas;
  if (cambios.fotos !== undefined) update.fotos = cambios.fotos;
  if (cambios.imagenUrl !== undefined) update.imagen_url = cambios.imagenUrl;
  if (cambios.tipoVenta !== undefined) update.tipo_venta = cambios.tipoVenta;
  if (cambios.activo !== undefined) update.activo = cambios.activo;
  if (cambios.telegramReportesActivos !== undefined) update.telegram_reportes_activos = cambios.telegramReportesActivos;

  const r = await escribirConReportes(update, u =>
    supabaseAdmin.from('clientes').update(u).eq('id', id).select('*').maybeSingle()
  );
  if ('pendiente' in r) return { error: r.mensaje, pendiente: true };
  const { data, error } = r;
  if (esColumnaInexistente(error, 'imagen_url')) return { error: MENSAJE_IMAGEN_CLIENTE_PENDIENTE, pendiente: true };
  if (error) return { error: error.message };
  if (!data) return { error: 'Cliente no encontrado.' };
  return { cliente: toPublico(data as ClienteRow) };
}

export async function desactivarCliente(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('clientes')
    .update({ activo: false })
    .eq('id', id);
  return !error;
}

export async function reactivarCliente(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('clientes')
    .update({ activo: true })
    .eq('id', id);
  return !error;
}

export async function borrarCliente(id: string): Promise<{ ok: boolean; razon?: string }> {
  const { error } = await supabaseAdmin.from('clientes').delete().eq('id', id);
  if (error) return { ok: false, razon: error.message };
  return { ok: true };
}
