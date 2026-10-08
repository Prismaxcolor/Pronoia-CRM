import { supabaseAdmin } from '../config/supabase.js';
import { esObjetoInexistente } from '../utils/migracion-pendiente.js';
import { ErrorLecturaBd, leerPaginado } from '../utils/paginacion.js';
import { construirEstadoCuenta, type AsientoMesa, type EstadoCuentaCalculado, type RangoFechas } from '../utils/mesa-cambio.js';
import type { ActualizarCambistaInput, CrearAsientoInput, CrearCambistaInput } from '../schemas/mesa-cambio.js';

/** Espejo de shared/types/mesa-cambio.ts (se duplica por la misma razón que utils/permisos.ts). */
export interface Cambista {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  notas: string | null;
  activo: boolean;
  creadoEn: string;
}

export interface CambistaConSaldo extends Cambista {
  saldo: number;
  asientos: number;
}

export interface EstadoCuentaMesa extends EstadoCuentaCalculado {
  cambista: Cambista;
  desde: string | null;
  hasta: string | null;
}

export interface AsientoCreado {
  id: string;
  numero: number;
  cambistaId: string;
  tipo: 'CARGO' | 'COBRO';
  montoUsd: number;
  fecha: string;
}

type Fallo = { error: string; codigo: number };

const MENSAJE_MIGRACION_PENDIENTE =
  'La mesa de cambio aún no está habilitada en la base de datos (falta aplicar migration_mesa_cambio.sql).';
const COLUMNAS_ASIENTO =
  'id, numero, cambista_id, tipo, monto_usd, tasa, fecha, nota, referencia, anulado, anulado_motivo';

interface ErrorBd {
  code?: string;
  message?: string;
}

/** Traduce un error de BD a un fallo con código HTTP (503 si falta la migración, 409 por nombre repetido). */
function fallo(error: ErrorBd, porDefecto: string): Fallo {
  if (esObjetoInexistente(error)) return { error: MENSAJE_MIGRACION_PENDIENTE, codigo: 503 };
  if (error.code === '23505') return { error: 'Ya existe un cambista con ese nombre.', codigo: 409 };
  return { error: porDefecto, codigo: 500 };
}

function mapCambista(row: Record<string, unknown>): Cambista {
  return {
    id: row.id as string,
    nombre: row.nombre as string,
    telefono: (row.telefono as string) ?? null,
    email: (row.email as string) ?? null,
    notas: (row.notas as string) ?? null,
    activo: Boolean(row.activo),
    creadoEn: row.created_at as string,
  };
}

function mapAsiento(row: Record<string, unknown>): AsientoMesa {
  return {
    id: row.id as string,
    numero: Number(row.numero),
    tipo: row.tipo as AsientoMesa['tipo'],
    montoUsd: Number(row.monto_usd),
    fecha: row.fecha as string,
    anulado: Boolean(row.anulado),
    tasa: row.tasa != null ? Number(row.tasa) : null,
    nota: (row.nota as string) ?? null,
    referencia: (row.referencia as string) ?? null,
    anuladoMotivo: (row.anulado_motivo as string) ?? null,
  };
}

export async function listarCambistas(): Promise<{ cambistas: CambistaConSaldo[] } | Fallo> {
  const [lista, saldos] = await Promise.all([
    supabaseAdmin.from('cambistas').select('*').order('nombre'),
    supabaseAdmin.from('cambistas_saldos').select('cambista_id, saldo, asientos'),
  ]);
  const err = lista.error ?? saldos.error;
  if (err) return fallo(err, 'No se pudieron cargar los cambistas.');
  const porId = new Map((saldos.data ?? []).map(s => [s.cambista_id as string, s]));
  const cambistas = (lista.data ?? []).map(row => {
    const s = porId.get(row.id as string);
    return { ...mapCambista(row), saldo: Number(s?.saldo ?? 0), asientos: Number(s?.asientos ?? 0) };
  });
  return { cambistas };
}

export async function obtenerCambista(id: string): Promise<{ cambista: Cambista } | Fallo> {
  const { data, error } = await supabaseAdmin.from('cambistas').select('*').eq('id', id).maybeSingle();
  if (error) return fallo(error, 'No se pudo cargar el cambista.');
  if (!data) return { error: 'Cambista no encontrado.', codigo: 404 };
  return { cambista: mapCambista(data) };
}

export async function crearCambista(input: CrearCambistaInput): Promise<{ cambista: Cambista } | Fallo> {
  const { data, error } = await supabaseAdmin.from('cambistas').insert(input).select().single();
  if (error || !data) return fallo(error ?? {}, 'No se pudo crear el cambista.');
  return { cambista: mapCambista(data) };
}

export async function actualizarCambista(id: string, input: ActualizarCambistaInput): Promise<{ cambista: Cambista } | Fallo> {
  const campos = { ...input, updated_at: new Date().toISOString() };
  const { data, error } = await supabaseAdmin.from('cambistas').update(campos).eq('id', id).select().maybeSingle();
  if (error) return fallo(error, 'No se pudo actualizar el cambista.');
  if (!data) return { error: 'Cambista no encontrado.', codigo: 404 };
  return { cambista: mapCambista(data) };
}

export async function obtenerEstadoCuenta(id: string, rango: RangoFechas): Promise<{ estado: EstadoCuentaMesa } | Fallo> {
  const encontrado = await obtenerCambista(id);
  if ('error' in encontrado) return encontrado;
  // PostgREST corta cada respuesta en 1000 filas: sin paginar, un cambista con más asientos tendría un saldo falso.
  let filas: Record<string, unknown>[];
  try {
    filas = await leerPaginado<Record<string, unknown>>((desde, hasta) =>
      supabaseAdmin
        .from('cambista_asientos')
        .select(COLUMNAS_ASIENTO)
        .eq('cambista_id', id)
        .order('numero', { ascending: true })
        .range(desde, hasta)
    );
  } catch (e) {
    return fallo(e instanceof ErrorLecturaBd ? e : {}, 'No se pudo cargar el estado de cuenta.');
  }
  const calculado = construirEstadoCuenta(filas.map(mapAsiento), rango);
  return {
    estado: { ...calculado, cambista: encontrado.cambista, desde: rango.desde ?? null, hasta: rango.hasta ?? null },
  };
}

export async function crearAsiento(input: CrearAsientoInput, userId: string): Promise<{ asiento: AsientoCreado } | Fallo> {
  const encontrado = await obtenerCambista(input.cambistaId);
  if ('error' in encontrado) return encontrado;
  if (!encontrado.cambista.activo) return { error: 'El cambista está inactivo: actívalo para registrar asientos.', codigo: 409 };
  const { data, error } = await supabaseAdmin
    .from('cambista_asientos')
    .insert({
      cambista_id: input.cambistaId,
      tipo: input.tipo,
      monto_usd: input.montoUsd,
      tasa: input.tasa,
      fecha: input.fecha,
      nota: input.nota,
      referencia: input.referencia,
      registrado_por: userId,
    })
    .select(COLUMNAS_ASIENTO)
    .single();
  if (error || !data) return fallo(error ?? {}, 'No se pudo registrar el asiento.');
  const a = mapAsiento(data);
  return { asiento: { id: a.id, numero: a.numero, cambistaId: input.cambistaId, tipo: a.tipo, montoUsd: a.montoUsd, fecha: a.fecha } };
}

/** Anula un asiento vigente (nunca se borra). Solo actualiza si sigue vigente, así dos anulaciones simultáneas no pisan el motivo. */
export async function anularAsiento(id: string, motivo: string, userId: string): Promise<{ ok: true } | Fallo> {
  const { data, error } = await supabaseAdmin
    .from('cambista_asientos')
    .update({ anulado: true, anulado_motivo: motivo, anulado_at: new Date().toISOString(), anulado_por: userId })
    .eq('id', id)
    .eq('anulado', false)
    .select('id')
    .maybeSingle();
  if (error) return fallo(error, 'No se pudo anular el asiento.');
  if (data) return { ok: true };
  const { data: existe } = await supabaseAdmin.from('cambista_asientos').select('id').eq('id', id).maybeSingle();
  return existe ? { error: 'El asiento ya está anulado.', codigo: 409 } : { error: 'Asiento no encontrado.', codigo: 404 };
}
