import { supabaseAdmin } from '../config/supabase.js';
import { falloNomina, type FalloNomina } from '../utils/nomina-errores.js';
import type { Trabajador, TipoTrabajador } from '../../../shared/types/nomina.js';
import type { ActualizarTrabajadorInput, CrearTrabajadorInput } from '../schemas/nomina.js';

const MENSAJE_CEDULA_REPETIDA = 'Ya existe un trabajador con esa cédula.';
const LIMITE_TRABAJADORES = 1000;

type Fila = Record<string, unknown>;

const texto = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export function mapTrabajador(row: Fila): Trabajador {
  return {
    id: row.id as string,
    tipo: row.tipo as TipoTrabajador,
    nombres: row.nombres as string,
    apellidos: row.apellidos as string,
    cedula: row.cedula as string,
    rif: texto(row.rif),
    telefono: texto(row.telefono),
    direccion: texto(row.direccion),
    puesto: texto(row.puesto),
    contactoEmergenciaNombre: texto(row.contacto_emergencia_nombre),
    contactoEmergenciaTelefono: texto(row.contacto_emergencia_telefono),
    pagoMovilBanco: texto(row.pago_movil_banco),
    pagoMovilTelefono: texto(row.pago_movil_telefono),
    pagoMovilCedula: texto(row.pago_movil_cedula),
    binanceCorreoId: texto(row.binance_correo_id),
    pagoDiarioUsd: Number(row.pago_diario_usd ?? 0),
    pagoDiarioBs: Number(row.pago_diario_bs ?? 0),
    activo: Boolean(row.activo),
    creadoEn: row.created_at as string,
  };
}

/** La ficha completa (lo que lee mapTrabajador), con columnas explícitas: una columna nueva no se expone sin querer. */
const COLUMNAS_FICHA = 'id, tipo, nombres, apellidos, cedula, rif, telefono, direccion, puesto, contacto_emergencia_nombre, contacto_emergencia_telefono, pago_movil_banco, pago_movil_telefono, pago_movil_cedula, binance_correo_id, pago_diario_usd, pago_diario_bs, activo, created_at';

const COLUMNAS: Record<string, string> = {
  tipo: 'tipo', nombres: 'nombres', apellidos: 'apellidos', cedula: 'cedula', rif: 'rif', telefono: 'telefono',
  direccion: 'direccion', puesto: 'puesto', contactoEmergenciaNombre: 'contacto_emergencia_nombre',
  contactoEmergenciaTelefono: 'contacto_emergencia_telefono', pagoMovilBanco: 'pago_movil_banco',
  pagoMovilTelefono: 'pago_movil_telefono', pagoMovilCedula: 'pago_movil_cedula', binanceCorreoId: 'binance_correo_id',
  pagoDiarioUsd: 'pago_diario_usd', pagoDiarioBs: 'pago_diario_bs', activo: 'activo',
};

/** Pasa el cuerpo validado a columnas de la tabla, omitiendo lo no enviado (undefined) y descartando cualquier otra clave. */
export function aColumnas(input: Record<string, unknown>): Fila {
  return Object.fromEntries(
    Object.entries(input).filter(([k, v]) => k in COLUMNAS && v !== undefined).map(([k, v]) => [COLUMNAS[k], v]),
  );
}

export async function listarTrabajadores(
  filtro: { tipo?: TipoTrabajador; incluirInactivos: boolean },
): Promise<{ trabajadores: Trabajador[] } | FalloNomina> {
  let q = supabaseAdmin.from('nomina_trabajadores').select(COLUMNAS_FICHA).order('apellidos').order('nombres').limit(LIMITE_TRABAJADORES);
  if (filtro.tipo) q = q.eq('tipo', filtro.tipo);
  if (!filtro.incluirInactivos) q = q.eq('activo', true);
  const { data, error } = await q;
  if (error) return falloNomina(error, 'trabajadores_listar', 'No se pudo cargar el personal.');
  return { trabajadores: (data ?? []).map(mapTrabajador) };
}

export async function obtenerTrabajador(id: string): Promise<{ trabajador: Trabajador } | FalloNomina> {
  const { data, error } = await supabaseAdmin.from('nomina_trabajadores').select(COLUMNAS_FICHA).eq('id', id).maybeSingle();
  if (error) return falloNomina(error, 'trabajador_obtener', 'No se pudo cargar el trabajador.');
  if (!data) return { error: 'Trabajador no encontrado.', codigo: 404 };
  return { trabajador: mapTrabajador(data) };
}

export async function crearTrabajador(input: CrearTrabajadorInput): Promise<{ trabajador: Trabajador } | FalloNomina> {
  const { data, error } = await supabaseAdmin.from('nomina_trabajadores').insert(aColumnas(input)).select(COLUMNAS_FICHA).single();
  if (error || !data) return falloNomina(error, 'trabajador_crear', 'No se pudo crear el trabajador.', MENSAJE_CEDULA_REPETIDA);
  return { trabajador: mapTrabajador(data) };
}

export async function actualizarTrabajador(id: string, input: ActualizarTrabajadorInput): Promise<{ trabajador: Trabajador } | FalloNomina> {
  const campos = { ...aColumnas(input), updated_at: new Date().toISOString() };
  const { data, error } = await supabaseAdmin.from('nomina_trabajadores').update(campos).eq('id', id).select(COLUMNAS_FICHA).maybeSingle();
  if (error) return falloNomina(error, 'trabajador_actualizar', 'No se pudo actualizar el trabajador.', MENSAJE_CEDULA_REPETIDA);
  if (!data) return { error: 'Trabajador no encontrado.', codigo: 404 };
  return { trabajador: mapTrabajador(data) };
}

/** Soft-delete: el trabajador se conserva (sus nóminas y préstamos siguen apuntando a él) pero ya no aparece ni se agrega a nóminas. */
export async function desactivarTrabajador(id: string): Promise<{ ok: true } | FalloNomina> {
  const { data, error } = await supabaseAdmin
    .from('nomina_trabajadores').update({ activo: false, updated_at: new Date().toISOString() }).eq('id', id).select('id').maybeSingle();
  if (error) return falloNomina(error, 'trabajador_desactivar', 'No se pudo desactivar al trabajador.');
  if (!data) return { error: 'Trabajador no encontrado.', codigo: 404 };
  return { ok: true };
}
