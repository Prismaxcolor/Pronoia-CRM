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

/** Quita `color` de un objeto de escritura (para degradar si la columna aún no existe). */
function sinColor<T extends { color?: unknown }>(campos: T): Omit<T, 'color'> {
  const { color: _color, ...resto } = campos;
  return resto;
}

export async function crearBanca(input: CrearBancaInput): Promise<{ banca: Banca } | { error: string }> {
  const base = { nombre: input.nombre, tipo: input.tipo, moneda: input.moneda, descripcion: input.descripcion, saldo: 0 };
  // Solo si hay color: una banca sin color no depende de la columna.
  const conColor = input.color ? { ...base, color: input.color } : base;
  let { data, error } = await supabaseAdmin.from('bancas').insert(conColor).select().single();
  // Migración del color sin aplicar: se crea la banca sin color en vez de fallar.
  if (error && input.color && esObjetoInexistente(error)) {
    ({ data, error } = await supabaseAdmin.from('bancas').insert(base).select().single());
  }

  if (error || !data) return { error: error?.message ?? 'No se pudo crear la banca.' };
  return { banca: mapBanca(data) };
}

export async function actualizarBanca(
  id: string,
  campos: ActualizarBancaInput
): Promise<{ banca: Banca } | { error: string }> {
  const escribir = (valores: object) => supabaseAdmin.from('bancas').update(valores).eq('id', id).select().maybeSingle();
  let { data, error } = await escribir(campos);
  if (error && campos.color !== undefined && esObjetoInexistente(error)) {
    ({ data, error } = await escribir(sinColor(campos)));
  }

  if (error) return { error: error.message };
  if (!data) return { error: 'Banca no encontrada.' };
  return { banca: mapBanca(data) };
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
