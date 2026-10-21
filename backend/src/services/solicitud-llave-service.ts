import { supabaseAdmin } from '../config/supabase.js';
import { ENV } from '../config/env.js';
import { crearLlave, verificarEntidad } from './llave-edicion-service.js';
import { nombreDeUsuario, registrarAuditoria } from './auditoria-service.js';
import { avisarResolucionLlave, avisarSolicitudLlave } from './solicitud-llave-aviso.js';
import { hashLlave } from '../utils/llave-edicion.js';
import type { EntidadConLlave } from '../utils/auditoria.js';
import type { EstadoSolicitudLlave, SolicitudLlaveAviso } from '../utils/solicitud-llave-tipos.js';
import {
  armarDescripcion,
  calcularExpiracionSolicitud,
  cifrarCodigo,
  descifrarCodigo,
  estadoEfectivo,
} from '../utils/solicitud-llave.js';
import { logger } from '../utils/logger.js';

export interface SolicitudLlaveDto {
  id: string;
  solicitanteId: string | null;
  solicitanteNombre: string;
  entidadTipo: string;
  entidadId: string;
  descripcion: string;
  motivo: string;
  estado: EstadoSolicitudLlave;
  aprobadorNombre: string | null;
  motivoRechazo: string | null;
  resueltaEn: string | null;
  createdAt: string;
  expiraEn: string;
  /** Solo en la respuesta que entrega el código al solicitante (una única vez). */
  codigo?: string;
}

export type ResultadoSolicitud<T> = { ok: true; data: T } | { ok: false; error: string; codigo: number };

interface SolicitudRow {
  id: string;
  solicitante_id: string | null;
  solicitante_nombre: string;
  entidad_tipo: string;
  entidad_id: string;
  descripcion: string;
  motivo: string;
  estado: EstadoSolicitudLlave;
  aprobador_id: string | null;
  aprobador_nombre: string | null;
  motivo_rechazo: string | null;
  resuelta_en: string | null;
  llave_id: string | null;
  codigo_cifrado: string | null;
  created_at: string;
  expira_en: string;
}

const MSG_NO_DISPONIBLE = 'El sistema de solicitudes de llave no está disponible en este momento (¿migración pendiente?).';
const NO_DISPONIBLE = { ok: false, error: MSG_NO_DISPONIBLE, codigo: 503 } as const;
const NO_ENCONTRADA = { ok: false, error: 'La solicitud no existe.', codigo: 404 } as const;

function toDto(row: SolicitudRow, estado: EstadoSolicitudLlave): SolicitudLlaveDto {
  return {
    id: row.id,
    solicitanteId: row.solicitante_id,
    solicitanteNombre: row.solicitante_nombre,
    entidadTipo: row.entidad_tipo,
    entidadId: row.entidad_id,
    descripcion: row.descripcion,
    motivo: row.motivo,
    estado,
    aprobadorNombre: row.aprobador_nombre,
    motivoRechazo: row.motivo_rechazo,
    resueltaEn: row.resuelta_en,
    createdAt: row.created_at,
    expiraEn: row.expira_en,
  };
}

function toAviso(row: SolicitudRow, estado: EstadoSolicitudLlave): SolicitudLlaveAviso {
  return {
    id: row.id,
    solicitanteId: row.solicitante_id,
    solicitanteNombre: row.solicitante_nombre,
    entidadTipo: row.entidad_tipo,
    entidadId: row.entidad_id,
    descripcion: row.descripcion,
    motivo: row.motivo,
    estado,
    aprobadorNombre: row.aprobador_nombre,
    motivoRechazo: row.motivo_rechazo,
    llaveExpiraEn: row.estado === 'aprobada' ? row.expira_en : null,
    venceEn: row.estado === 'pendiente' ? row.expira_en : null,
  };
}

/** Marca como expiradas las pendientes vencidas (expiración perezosa). Best-effort. */
async function expirarVencidas(): Promise<void> {
  const { error } = await supabaseAdmin
    .from('solicitudes_llave')
    .update({ estado: 'expirada' })
    .eq('estado', 'pendiente')
    .lte('expira_en', new Date().toISOString());
  if (error) logger.warn({ evento: 'solicitud_llave_expirar_fallo', motivo: error.message });
}

/** Estados efectivos de las aprobadas: consulta cuáles llaves ya se usaron. */
async function llavesUsadas(rows: SolicitudRow[]): Promise<Set<string>> {
  const ids = rows.filter(r => r.estado === 'aprobada' && r.llave_id).map(r => r.llave_id as string);
  if (ids.length === 0) return new Set();
  const { data } = await supabaseAdmin.from('llaves_edicion').select('id, usada_en').in('id', ids);
  return new Set((data ?? []).filter(l => l.usada_en).map(l => l.id as string));
}

async function dtosDe(rows: SolicitudRow[]): Promise<SolicitudLlaveDto[]> {
  const usadas = await llavesUsadas(rows);
  const ahora = new Date();
  return rows.map(r =>
    toDto(r, estadoEfectivo(r.estado, new Date(r.expira_en), ahora, !!r.llave_id && usadas.has(r.llave_id)))
  );
}

/** Descripción legible consultando la entidad; si algo falla degrada a "tipo #id corto". */
export async function describirEntidad(entidadTipo: string, entidadId: string): Promise<string> {
  try {
    if (entidadTipo === 'ticket_pesaje') {
      const { data } = await supabaseAdmin
        .from('tickets_pesaje')
        .select('numero, tipo, entidad_id')
        .eq('id', entidadId)
        .maybeSingle();
      if (data) {
        const esCompra = data.tipo === 'compra';
        const codigo = `${esCompra ? 'Compra' : 'Venta'}-${String(data.numero).padStart(4, '0')}`;
        let tercero: string | null = null;
        if (data.entidad_id) {
          const { data: ent } = await supabaseAdmin
            .from(esCompra ? 'proveedores' : 'clientes')
            .select('nombre')
            .eq('id', data.entidad_id)
            .maybeSingle();
          tercero = (ent?.nombre as string | undefined) ?? null;
        }
        return armarDescripcion(entidadTipo, entidadId, { codigo, tercero });
      }
    } else if (entidadTipo === 'traslado') {
      const { data } = await supabaseAdmin.from('tickets_traslado').select('numero').eq('id', entidadId).maybeSingle();
      if (data) return armarDescripcion(entidadTipo, entidadId, { codigo: `Traslado-${String(data.numero).padStart(4, '0')}` });
    }
  } catch (err) {
    logger.warn({ evento: 'solicitud_llave_describir_fallo', entidadTipo, entidadId, motivo: err instanceof Error ? err.message : String(err) });
  }
  return armarDescripcion(entidadTipo, entidadId);
}

export interface SolicitanteActual {
  userId: string;
  email?: string;
}

/** Crea la solicitud (o devuelve la pendiente que el mismo usuario ya tiene para ese documento). */
export async function crearSolicitud(
  actor: SolicitanteActual,
  entidadTipo: EntidadConLlave,
  entidadId: string,
  motivo: string
): Promise<ResultadoSolicitud<{ solicitud: SolicitudLlaveDto; existente: boolean }>> {
  const rechazo = await verificarEntidad(entidadTipo, entidadId);
  if (rechazo) return { ok: false, ...rechazo };

  await expirarVencidas();
  const { data: previa, error: errPrevia } = await supabaseAdmin
    .from('solicitudes_llave')
    .select('*')
    .eq('solicitante_id', actor.userId)
    .eq('entidad_tipo', entidadTipo)
    .eq('entidad_id', entidadId)
    .eq('estado', 'pendiente')
    .gt('expira_en', new Date().toISOString())
    .maybeSingle();
  if (errPrevia) return NO_DISPONIBLE;
  if (previa) {
    const [dto] = await dtosDe([previa as SolicitudRow]);
    return { ok: true, data: { solicitud: dto as SolicitudLlaveDto, existente: true } };
  }

  const [nombre, descripcion] = await Promise.all([nombreDeUsuario(actor.userId), describirEntidad(entidadTipo, entidadId)]);
  const { data, error } = await supabaseAdmin
    .from('solicitudes_llave')
    .insert({
      solicitante_id: actor.userId,
      solicitante_nombre: nombre ?? actor.email ?? 'desconocido',
      entidad_tipo: entidadTipo,
      entidad_id: entidadId,
      descripcion,
      motivo,
      expira_en: calcularExpiracionSolicitud(new Date()).toISOString(),
    })
    .select('*')
    .single();
  if (error || !data) {
    logger.error({ evento: 'solicitud_llave_no_creada', userId: actor.userId, entidadTipo, entidadId, motivo: error?.message });
    return NO_DISPONIBLE;
  }
  const row = data as SolicitudRow;
  logger.info({ evento: 'solicitud_llave_creada', userId: actor.userId, solicitudId: row.id, entidadTipo, entidadId });
  await avisarSolicitudLlave(toAviso(row, 'pendiente'));
  return { ok: true, data: { solicitud: toDto(row, 'pendiente'), existente: false } };
}

async function leerFila(id: string): Promise<ResultadoSolicitud<SolicitudRow>> {
  const { data, error } = await supabaseAdmin.from('solicitudes_llave').select('*').eq('id', id).maybeSingle();
  if (error) return NO_DISPONIBLE;
  if (!data) return NO_ENCONTRADA;
  return { ok: true, data: data as SolicitudRow };
}

/**
 * Detalle de una solicitud. Solo el solicitante o un superadmin. Si está aprobada y quien consulta es
 * el solicitante, devuelve el código en claro UNA vez (update condicional que lo borra).
 */
export async function obtenerSolicitud(
  id: string,
  userId: string,
  esSuperadmin: boolean
): Promise<ResultadoSolicitud<SolicitudLlaveDto>> {
  const leida = await leerFila(id);
  if (!leida.ok) return leida;
  const row = leida.data;
  if (row.solicitante_id !== userId && !esSuperadmin) return NO_ENCONTRADA;

  const [dto] = await dtosDe([row]);
  const resultado = dto as SolicitudLlaveDto;
  if (resultado.estado === 'aprobada' && row.codigo_cifrado && row.solicitante_id === userId) {
    const codigo = await entregarCodigo(row);
    if (codigo) return { ok: true, data: { ...resultado, codigo } };
  }
  return { ok: true, data: resultado };
}

/** Borra el código cifrado y lo devuelve; si otra petición ya lo entregó, devuelve null. */
async function entregarCodigo(row: SolicitudRow): Promise<string | null> {
  const codigo = descifrarCodigo(row.codigo_cifrado as string, ENV.JWT_SECRET);
  const { data, error } = await supabaseAdmin
    .from('solicitudes_llave')
    .update({ codigo_cifrado: null, codigo_entregado_en: new Date().toISOString() })
    .eq('id', row.id)
    .not('codigo_cifrado', 'is', null)
    .select('id');
  if (error || (data ?? []).length === 0) return null;
  if (!codigo) logger.error({ evento: 'solicitud_llave_descifrado_fallo', solicitudId: row.id });
  return codigo;
}

/** Estado y datos de una solicitud para el flujo de Telegram. Nunca incluye ni entrega el código de la llave. */
export async function resumenSolicitud(id: string): Promise<ResultadoSolicitud<SolicitudLlaveDto>> {
  await expirarVencidas();
  const leida = await leerFila(id);
  if (!leida.ok) return leida;
  const [dto] = await dtosDe([leida.data]);
  return { ok: true, data: dto as SolicitudLlaveDto };
}

export async function listarMias(userId: string): Promise<ResultadoSolicitud<SolicitudLlaveDto[]>> {
  await expirarVencidas();
  const { data, error } = await supabaseAdmin
    .from('solicitudes_llave')
    .select('*')
    .eq('solicitante_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return NO_DISPONIBLE;
  return { ok: true, data: await dtosDe((data ?? []) as SolicitudRow[]) };
}

export async function listarPorEstado(estado: EstadoSolicitudLlave): Promise<ResultadoSolicitud<SolicitudLlaveDto[]>> {
  await expirarVencidas();
  const { data, error } = await supabaseAdmin
    .from('solicitudes_llave')
    .select('*')
    .eq('estado', estado)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return NO_DISPONIBLE;
  const dtos = await dtosDe((data ?? []) as SolicitudRow[]);
  // Una aprobada ya vencida o usada deja de ser "aprobada" para quien filtra por estado.
  return { ok: true, data: dtos.filter(d => d.estado === estado) };
}

export async function contarPendientes(): Promise<ResultadoSolicitud<number>> {
  await expirarVencidas();
  const { count, error } = await supabaseAdmin
    .from('solicitudes_llave')
    .select('id', { count: 'exact', head: true })
    .eq('estado', 'pendiente');
  if (error) return NO_DISPONIBLE;
  return { ok: true, data: count ?? 0 };
}

const YA_RESUELTA = { ok: false, error: 'La solicitud ya fue resuelta o venció.', codigo: 409 } as const;

export async function aprobarSolicitud(id: string, aprobadorId: string): Promise<ResultadoSolicitud<SolicitudLlaveDto>> {
  const ahora = new Date().toISOString();
  const aprobadorNombre = (await nombreDeUsuario(aprobadorId)) ?? 'superadmin';
  // Reclamo atómico: solo una petición pasa de pendiente a aprobada.
  const { data: reclamada, error } = await supabaseAdmin
    .from('solicitudes_llave')
    .update({ estado: 'aprobada', aprobador_id: aprobadorId, aprobador_nombre: aprobadorNombre, resuelta_en: ahora })
    .eq('id', id)
    .eq('estado', 'pendiente')
    .gt('expira_en', ahora)
    .select('*');
  if (error) return NO_DISPONIBLE;
  const row = ((reclamada ?? [])[0] ?? null) as SolicitudRow | null;
  if (!row) {
    const existe = await leerFila(id);
    return existe.ok ? YA_RESUELTA : existe;
  }

  const llave = await crearLlave(row.entidad_tipo as EntidadConLlave, row.entidad_id, aprobadorId);
  if ('error' in llave) {
    // Revierte el reclamo para que el superadmin pueda reintentar.
    await supabaseAdmin
      .from('solicitudes_llave')
      .update({ estado: 'pendiente', aprobador_id: null, aprobador_nombre: null, resuelta_en: null })
      .eq('id', id)
      .eq('estado', 'aprobada')
      .is('llave_id', null);
    return { ok: false, error: llave.error, codigo: llave.codigo };
  }

  const { data: final, error: errFinal } = await supabaseAdmin
    .from('solicitudes_llave')
    .update({
      codigo_cifrado: cifrarCodigo(llave.codigo, ENV.JWT_SECRET),
      expira_en: llave.expiraEn,
      llave_id: await idDeLlave(llave.codigo),
    })
    .eq('id', id)
    .select('*')
    .single();
  if (errFinal || !final) {
    logger.error({ evento: 'solicitud_llave_guardar_codigo_fallo', solicitudId: id, motivo: errFinal?.message });
    return NO_DISPONIBLE;
  }

  const filaFinal = final as SolicitudRow;
  await registrarAuditoria({
    entidadTipo: row.entidad_tipo as EntidadConLlave,
    entidadId: row.entidad_id,
    accion: 'llave_aprobada',
    usuarioId: aprobadorId,
    usuarioNombre: aprobadorNombre,
    cambios: {
      solicitante: { antes: null, despues: row.solicitante_nombre },
      motivo: { antes: null, despues: row.motivo },
    },
  });
  logger.info({ evento: 'solicitud_llave_aprobada', userId: aprobadorId, solicitudId: id });
  await avisarResolucionLlave(toAviso(filaFinal, 'aprobada'));
  return { ok: true, data: toDto(filaFinal, 'aprobada') };
}

/** Id de la llave recién creada (crearLlave solo devuelve el código). */
async function idDeLlave(codigo: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('llaves_edicion').select('id').eq('token_hash', hashLlave(codigo)).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function rechazarSolicitud(
  id: string,
  aprobadorId: string,
  motivoRechazo?: string
): Promise<ResultadoSolicitud<SolicitudLlaveDto>> {
  const ahora = new Date().toISOString();
  const aprobadorNombre = (await nombreDeUsuario(aprobadorId)) ?? 'superadmin';
  const { data, error } = await supabaseAdmin
    .from('solicitudes_llave')
    .update({
      estado: 'rechazada',
      aprobador_id: aprobadorId,
      aprobador_nombre: aprobadorNombre,
      motivo_rechazo: motivoRechazo ?? null,
      resuelta_en: ahora,
    })
    .eq('id', id)
    .eq('estado', 'pendiente')
    .gt('expira_en', ahora)
    .select('*');
  if (error) return NO_DISPONIBLE;
  const row = ((data ?? [])[0] ?? null) as SolicitudRow | null;
  if (!row) {
    const existe = await leerFila(id);
    return existe.ok ? YA_RESUELTA : existe;
  }
  await registrarAuditoria({
    entidadTipo: row.entidad_tipo as EntidadConLlave,
    entidadId: row.entidad_id,
    accion: 'llave_rechazada',
    usuarioId: aprobadorId,
    usuarioNombre: aprobadorNombre,
    cambios: {
      solicitante: { antes: null, despues: row.solicitante_nombre },
      motivo_rechazo: { antes: null, despues: motivoRechazo ?? null },
    },
  });
  logger.info({ evento: 'solicitud_llave_rechazada', userId: aprobadorId, solicitudId: id });
  await avisarResolucionLlave(toAviso(row, 'rechazada'));
  return { ok: true, data: toDto(row, 'rechazada') };
}
