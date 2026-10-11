import { supabaseAdmin } from '../config/supabase.js';
import { falloNomina, type FalloNomina } from '../utils/nomina-errores.js';
import type { EstadoPrestamo, Prestamo, TipoPrestamo } from '../../../shared/types/nomina.js';
import type { ActualizarPrestamoInput, CrearPrestamoInput } from '../schemas/nomina.js';

const LIMITE_PRESTAMOS = 1000;
const COLUMNAS = '*, trabajador:nomina_trabajadores(nombres, apellidos)';

type Fila = Record<string, unknown>;

function nombreDe(row: Fila): string {
  const t = row.trabajador as { nombres?: string; apellidos?: string } | null;
  return t ? `${t.nombres ?? ''} ${t.apellidos ?? ''}`.trim() : '';
}

export function mapPrestamo(row: Fila): Prestamo {
  return {
    id: row.id as string,
    numero: Number(row.numero),
    trabajadorId: row.trabajador_id as string,
    trabajadorNombre: nombreDe(row),
    tipo: row.tipo as TipoPrestamo,
    montoUsd: Number(row.monto_usd),
    saldoUsd: Number(row.saldo_usd),
    cuotaSemanalUsd: row.cuota_semanal_usd == null ? null : Number(row.cuota_semanal_usd),
    fecha: row.fecha as string,
    nota: (row.nota as string | null) ?? null,
    estado: row.estado as EstadoPrestamo,
    anuladoMotivo: (row.anulado_motivo as string | null) ?? null,
  };
}

export async function listarPrestamos(
  filtro: { trabajadorId?: string; estado?: EstadoPrestamo },
): Promise<{ prestamos: Prestamo[] } | FalloNomina> {
  let q = supabaseAdmin.from('nomina_prestamos').select(COLUMNAS).order('numero', { ascending: false }).limit(LIMITE_PRESTAMOS);
  if (filtro.trabajadorId) q = q.eq('trabajador_id', filtro.trabajadorId);
  if (filtro.estado) q = q.eq('estado', filtro.estado);
  const { data, error } = await q;
  if (error) return falloNomina(error, 'prestamos_listar', 'No se pudieron cargar los préstamos.');
  return { prestamos: (data ?? []).map(mapPrestamo) };
}

async function obtenerPrestamo(id: string): Promise<{ prestamo: Prestamo } | FalloNomina> {
  const { data, error } = await supabaseAdmin.from('nomina_prestamos').select(COLUMNAS).eq('id', id).maybeSingle();
  if (error) return falloNomina(error, 'prestamo_obtener', 'No se pudo cargar el préstamo.');
  if (!data) return { error: 'Préstamo no encontrado.', codigo: 404 };
  return { prestamo: mapPrestamo(data) };
}

export async function crearPrestamo(input: CrearPrestamoInput, userId: string): Promise<{ prestamo: Prestamo } | FalloNomina> {
  const { data: trabajador, error: errT } = await supabaseAdmin
    .from('nomina_trabajadores').select('id, activo').eq('id', input.trabajadorId).maybeSingle();
  if (errT) return falloNomina(errT, 'prestamo_crear_trabajador', 'No se pudo validar al trabajador.');
  if (!trabajador) return { error: 'Trabajador no encontrado.', codigo: 404 };
  if (!trabajador.activo) return { error: 'El trabajador está inactivo: reactívalo para darle un préstamo.', codigo: 409 };
  const { data, error } = await supabaseAdmin
    .from('nomina_prestamos')
    .insert({
      trabajador_id: input.trabajadorId, tipo: input.tipo, monto_usd: input.montoUsd, saldo_usd: input.montoUsd,
      cuota_semanal_usd: input.cuotaSemanalUsd, fecha: input.fecha, nota: input.nota ?? null, registrado_por: userId,
    })
    .select(COLUMNAS)
    .single();
  if (error || !data) return falloNomina(error, 'prestamo_crear', 'No se pudo registrar el préstamo.');
  return { prestamo: mapPrestamo(data) };
}

export async function actualizarPrestamo(id: string, input: ActualizarPrestamoInput): Promise<{ prestamo: Prestamo } | FalloNomina> {
  const actual = await obtenerPrestamo(id);
  if ('error' in actual) return actual;
  const { prestamo } = actual;
  if (prestamo.estado === 'ANULADO') return { error: 'Un préstamo anulado no se puede modificar.', codigo: 409 };
  if (input.cuotaSemanalUsd != null && input.cuotaSemanalUsd > prestamo.montoUsd) {
    return { error: 'La cuota semanal no puede ser mayor al monto del préstamo.', codigo: 400 };
  }
  const campos: Fila = { updated_at: new Date().toISOString() };
  if (input.cuotaSemanalUsd !== undefined) campos.cuota_semanal_usd = input.cuotaSemanalUsd;
  if (input.nota !== undefined) campos.nota = input.nota;
  const { error } = await supabaseAdmin.from('nomina_prestamos').update(campos).eq('id', id);
  if (error) return falloNomina(error, 'prestamo_actualizar', 'No se pudo actualizar el préstamo.');
  return obtenerPrestamo(id);
}

/** Anula un préstamo ACTIVO (nunca se borra). Si ya tiene cuotas descontadas, la BD lo rechaza con un mensaje claro. */
export async function anularPrestamo(id: string, motivo: string, userId: string): Promise<{ ok: true } | FalloNomina> {
  const { data, error } = await supabaseAdmin
    .from('nomina_prestamos')
    .update({ estado: 'ANULADO', anulado_motivo: motivo, anulado_at: new Date().toISOString(), anulado_por: userId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('estado', 'ACTIVO')
    .select('id')
    .maybeSingle();
  if (error) return falloNomina(error, 'prestamo_anular', 'No se pudo anular el préstamo.');
  if (data) return { ok: true };
  const existe = await obtenerPrestamo(id);
  if ('error' in existe) return existe;
  return { error: 'El préstamo ya está pagado o anulado.', codigo: 409 };
}
