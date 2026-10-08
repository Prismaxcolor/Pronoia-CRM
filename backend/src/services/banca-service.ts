import { supabaseAdmin } from '../config/supabase.js';
import { esObjetoInexistente } from '../utils/migracion-pendiente.js';
import type { CrearBancaInput, ActualizarBancaInput, CrearMovimientoInput } from '../schemas/cochinito.js';

/**
 * Espejo de shared/types/banca.ts y movimiento.ts. Se duplica intencionalmente
 * (ver nota en utils/permisos.ts): @shared no resuelve en runtime con
 * tsx + ESM + extensiones .js.
 */
export type TipoBanca = 'banco_nacional' | 'banco_internacional' | 'exchange' | 'efectivo';
export type TipoMovimiento = 'ingreso' | 'egreso' | 'transferencia';

export interface Banca {
  id: string;
  nombre: string;
  tipo: TipoBanca;
  saldo: number;
  moneda: string;
  descripcion: string;
  archivada: boolean;
  /** Clave de la paleta o hex #RRGGBB; null si la banca no tiene color (o la migración aún no se aplicó). */
  color: string | null;
  /** Chat de Telegram al que van los avisos de esta banca; null = grupo general de cajas. */
  telegramChatId: string | null;
}

export interface Movimiento {
  id: string;
  tipo: TipoMovimiento;
  monto: number;
  moneda: string;
  descripcion: string;
  bancaOrigenId: string;
  bancaDestinoId: string | null;
  fecha: string;
  referencia: string;
  registradoPor: string;
  proveedorId: string | null;
  clienteId: string | null;
  montoUsd: number | null;
  /** Solo transferencias entre monedas distintas: lo que entra a la banca destino. */
  montoDestino: number | null;
  creadoEn: string;
  subtipo: 'pago' | 'adelanto' | 'cobro' | 'anticipo' | null;
  numero: number | null;
  /** Correlativo del sistema (MV-) de un movimiento manual de Wallet; null en pagos/cobros (usan `numero`). */
  numeroSistema: number | null;
  grupoId: string | null;
  comprobantes: string[];
  /** true si el movimiento fue anulado: la fila se conserva, pero ya no cuenta en saldos ni estados de cuenta. */
  anulado: boolean;
  anuladoMotivo: string | null;
  anuladoEn: string | null;
  /** Id de quien anuló (el nombre lo resuelve quien lo muestre). */
  anuladoPor: string | null;
}

function mapBanca(row: Record<string, unknown>): Banca {
  return {
    id: row.id as string,
    nombre: row.nombre as string,
    tipo: (row.tipo as TipoBanca) ?? 'banco_nacional',
    saldo: Number(row.saldo),
    moneda: row.moneda as string,
    descripcion: (row.descripcion as string) ?? '',
    archivada: Boolean(row.archivada),
    color: typeof row.color === 'string' && row.color ? row.color : null,
    telegramChatId: typeof row.telegram_chat_id === 'string' && row.telegram_chat_id ? row.telegram_chat_id : null,
  };
}

function mapMovimiento(row: Record<string, unknown>): Movimiento {
  return {
    id: row.id as string,
    tipo: row.tipo as TipoMovimiento,
    monto: Number(row.monto),
    moneda: row.moneda as string,
    descripcion: (row.descripcion as string) ?? '',
    bancaOrigenId: row.banca_origen_id as string,
    bancaDestinoId: (row.banca_destino_id as string) ?? null,
    fecha: row.fecha as string,
    referencia: (row.referencia as string) ?? '',
    registradoPor: (row.registrado_por as string) ?? '',
    proveedorId: (row.proveedor_id as string) ?? null,
    clienteId: (row.cliente_id as string) ?? null,
    montoUsd: row.monto_usd != null ? Number(row.monto_usd) : null,
    montoDestino: row.monto_destino != null ? Number(row.monto_destino) : null,
    creadoEn: row.creado_en as string,
    subtipo: (row.subtipo as Movimiento['subtipo']) ?? null,
    numero: row.numero != null ? Number(row.numero) : null,
    numeroSistema: row.numero_sistema != null ? Number(row.numero_sistema) : null,
    grupoId: (row.grupo_id as string) ?? null,
    comprobantes: Array.isArray(row.comprobantes) ? (row.comprobantes as string[]) : [],
    anulado: Boolean(row.anulado),
    anuladoMotivo: (row.anulado_motivo as string) ?? null,
    anuladoEn: (row.anulado_at as string) ?? null,
    anuladoPor: (row.anulado_por as string) ?? null,
  };
}

export interface ListarBancasOpts {
  incluirArchivadas?: boolean;
}

export async function listarBancas(opts: ListarBancasOpts = {}): Promise<Banca[]> {
  let query = supabaseAdmin.from('bancas').select('*').order('nombre');
  if (!opts.incluirArchivadas) {
    query = query.eq('archivada', false);
  }
  const { data, error } = await query;
  if (error || !data) return [];
  return data.map(mapBanca);
}

export async function listarMovimientos(): Promise<Movimiento[]> {
  const { data, error } = await supabaseAdmin
    .from('movimientos')
    .select('*')
    .order('creado_en', { ascending: false });

  if (error || !data) return [];
  return data.map(mapMovimiento);
}

/** Un movimiento por id (null si no existe o la BD falla). */
export async function obtenerMovimiento(id: string): Promise<Movimiento | null> {
  const { data, error } = await supabaseAdmin.from('movimientos').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return mapMovimiento(data);
}

export interface DetalleMovimiento {
  movimiento: Movimiento;
  bancaOrigenNombre: string | null;
  bancaDestinoNombre: string | null;
  /** Solo si quien consulta puede ver proveedores / clientes (si no, null). */
  proveedorNombre: string | null;
  clienteNombre: string | null;
  registradoPorNombre: string | null;
  anuladoPorNombre: string | null;
}

export interface OpcionesDetalleMovimiento {
  verProveedores: boolean;
  verClientes: boolean;
}

/** Nombre por id en una tabla con columna `nombre` (null si no hay id o no existe). */
async function nombreDe(tabla: 'bancas' | 'proveedores' | 'clientes' | 'users', id: string | null): Promise<string | null> {
  if (!id) return null;
  const { data } = await supabaseAdmin.from(tabla).select('nombre').eq('id', id).maybeSingle();
  return (data as { nombre: string } | null)?.nombre ?? null;
}

/** Un movimiento con los nombres ya resueltos (bancas, tercero, quién lo registró y quién lo anuló). null si no existe. */
export async function obtenerDetalleMovimiento(id: string, opts: OpcionesDetalleMovimiento): Promise<DetalleMovimiento | null> {
  const movimiento = await obtenerMovimiento(id);
  if (!movimiento) return null;
  const [bancaOrigenNombre, bancaDestinoNombre, proveedorNombre, clienteNombre, registradoPorNombre, anuladoPorNombre] = await Promise.all([
    nombreDe('bancas', movimiento.bancaOrigenId),
    nombreDe('bancas', movimiento.bancaDestinoId),
    opts.verProveedores ? nombreDe('proveedores', movimiento.proveedorId) : Promise.resolve(null),
    opts.verClientes ? nombreDe('clientes', movimiento.clienteId) : Promise.resolve(null),
    nombreDe('users', movimiento.registradoPor || null),
    nombreDe('users', movimiento.anuladoPor),
  ]);
  return { movimiento, bancaOrigenNombre, bancaDestinoNombre, proveedorNombre, clienteNombre, registradoPorNombre, anuladoPorNombre };
}

/** Campos opcionales de bancas que dependen de una migración: si la columna falta se degrada sin ellos. */
type CamposBanca = { color?: unknown; telegramChatId?: unknown };

/** Pasa los campos del schema a columnas de BD (telegramChatId -> telegram_chat_id). */
function aColumnas<T extends CamposBanca>(campos: T): Record<string, unknown> {
  const { telegramChatId, ...resto } = campos;
  return telegramChatId === undefined ? resto : { ...resto, telegram_chat_id: telegramChatId };
}

const COLUMNAS_OPCIONALES = ['color', 'telegram_chat_id'] as const;

export const MENSAJE_TELEGRAM_BANCA_PENDIENTE =
  'El grupo de Telegram por cuenta aún no está habilitado en la base de datos (falta aplicar migration_bancas_telegram_chat.sql). Guarda sin grupo o aplica la migración.';

const usaColumnasOpcionales = (c: Record<string, unknown>): boolean => COLUMNAS_OPCIONALES.some(k => k in c);

/** Columnas opcionales que cita un error de "columna inexistente"; si no cita ninguna, se asumen todas. */
function columnasFaltantes(error: { message?: string }): string[] {
  const citadas = COLUMNAS_OPCIONALES.filter(c => (error.message ?? '').includes(c));
  return citadas.length > 0 ? citadas : [...COLUMNAS_OPCIONALES];
}

function sinColumnas(columnas: Record<string, unknown>, quitar: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(columnas).filter(([k]) => !quitar.includes(k)));
}

type RespEscritura = { data: Record<string, unknown> | null; error: { code?: string; message: string } | null };
type ResultadoEscritura = RespEscritura | { pendiente: true };

/**
 * Ejecuta la escritura degradando POR COLUMNA si una migración opcional falta (color / telegram_chat_id).
 * Si falta telegram_chat_id y se intentaba guardar un valor, no se descarta en silencio: pendiente => 409.
 * (Guardar telegram_chat_id = null sí se descarta: no hay nada que limpiar en una columna que no existe.)
 */
async function escribirDegradando(
  columnas: Record<string, unknown>,
  ejecutar: (c: Record<string, unknown>) => PromiseLike<RespEscritura>
): Promise<ResultadoEscritura> {
  let actuales = columnas;
  for (let intento = 0; intento <= COLUMNAS_OPCIONALES.length; intento++) {
    const resp = await ejecutar(actuales);
    if (!resp.error || !esObjetoInexistente(resp.error) || !usaColumnasOpcionales(actuales)) return resp;
    const faltan = columnasFaltantes(resp.error).filter(c => c in actuales);
    if (faltan.length === 0) return resp;
    if (faltan.includes('telegram_chat_id') && actuales.telegram_chat_id != null) return { pendiente: true };
    actuales = sinColumnas(actuales, faltan);
  }
  return ejecutar(actuales);
}

export type ResultadoBanca = { banca: Banca } | { error: string; pendiente?: boolean };

export async function crearBanca(input: CrearBancaInput): Promise<ResultadoBanca> {
  const base = { nombre: input.nombre, tipo: input.tipo, moneda: input.moneda, descripcion: input.descripcion, saldo: 0 };
  // Solo lo que venga: una banca sin color ni grupo no depende de las columnas opcionales.
  const completo: Record<string, unknown> = {
    ...base,
    ...(input.color ? { color: input.color } : {}),
    ...(input.telegramChatId ? { telegram_chat_id: input.telegramChatId } : {}),
  };
  const r = await escribirDegradando(completo, c => supabaseAdmin.from('bancas').insert(c).select().single());
  if ('pendiente' in r) return { error: MENSAJE_TELEGRAM_BANCA_PENDIENTE, pendiente: true };
  if (r.error || !r.data) return { error: r.error?.message ?? 'No se pudo crear la banca.' };
  return { banca: mapBanca(r.data) };
}

/** Grupo de Telegram actual de una banca (para auditar cambios). null si no tiene, no existe o la columna falta. */
export async function leerTelegramChatIdBanca(id: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('bancas').select('telegram_chat_id').eq('id', id).maybeSingle();
  const valor = (data as { telegram_chat_id?: string | null } | null)?.telegram_chat_id;
  return typeof valor === 'string' && valor ? valor : null;
}

export async function actualizarBanca(id: string, campos: ActualizarBancaInput): Promise<ResultadoBanca> {
  const r = await escribirDegradando(aColumnas(campos), c =>
    supabaseAdmin.from('bancas').update(c).eq('id', id).select().maybeSingle()
  );
  if ('pendiente' in r) return { error: MENSAJE_TELEGRAM_BANCA_PENDIENTE, pendiente: true };
  if (r.error) return { error: r.error.message };
  if (!r.data) return { error: 'Banca no encontrada.' };
  return { banca: mapBanca(r.data) };
}

export interface ArchivarBancaResult {
  ok: boolean;
  razon?: string;
}

/**
 * Archiva una banca (soft delete). El saldo se lee de la BD (no del cliente)
 * para no depender de un valor que el frontend podría enviar desactualizado.
 * No se permite borrar físicamente: regla de dominio del CLAUDE.md — "en
 * finanzas NUNCA se borra; se reversa con un movimiento contrario".
 */
export async function archivarBanca(id: string): Promise<ArchivarBancaResult> {
  const { data: banca, error: errLectura } = await supabaseAdmin
    .from('bancas')
    .select('saldo')
    .eq('id', id)
    .maybeSingle();

  if (errLectura || !banca) return { ok: false, razon: 'Banca no encontrada.' };
  if (Math.abs(Number(banca.saldo)) > 0.001) {
    return {
      ok: false,
      razon: 'No se puede archivar una banca con saldo distinto de 0. Transfiere o retira los fondos primero.',
    };
  }

  const { error } = await supabaseAdmin
    .from('bancas')
    .update({ archivada: true, archivada_en: new Date().toISOString() })
    .eq('id', id);

  if (error) return { ok: false, razon: error.message };
  return { ok: true };
}

export async function desarchivarBanca(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('bancas')
    .update({ archivada: false, archivada_en: null })
    .eq('id', id);
  return !error;
}

/** Crea un movimiento de ingreso, egreso o transferencia. El trigger SQL ajusta el saldo. */
export async function crearMovimiento(
  input: CrearMovimientoInput,
  registradoPor: string
): Promise<{ movimiento: Movimiento } | { error: string }> {
  const esTransferencia = input.tipo === 'transferencia';
  const { data, error } = await supabaseAdmin
    .from('movimientos')
    .insert({
      tipo: input.tipo,
      monto: input.monto,
      monto_destino: esTransferencia ? (input.montoDestino ?? null) : null,
      moneda: input.moneda,
      descripcion: input.descripcion,
      banca_origen_id: input.bancaId,
      banca_destino_id: esTransferencia ? input.bancaDestinoId : null,
      fecha: input.fecha,
      referencia: input.referencia,
      registrado_por: registradoPor,
      proveedor_id: input.proveedorId ?? null,
      cliente_id: input.clienteId ?? null,
      // Solo si hay comprobante: así un movimiento sin imagen no depende de la columna.
      ...(input.comprobantes.length > 0 ? { comprobantes: input.comprobantes } : {}),
    })
    .select()
    .single();

  if (error || !data) return { error: error?.message ?? 'No se pudo registrar el movimiento.' };
  return { movimiento: mapMovimiento(data) };
}
