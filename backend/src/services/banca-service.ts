import { supabaseAdmin } from '../config/supabase.js';
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
  subtipo: 'pago' | 'adelanto' | null;
  numero: number | null;
  grupoId: string | null;
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
    subtipo: (row.subtipo as 'pago' | 'adelanto' | null) ?? null,
    numero: row.numero != null ? Number(row.numero) : null,
    grupoId: (row.grupo_id as string) ?? null,
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

export async function crearBanca(input: CrearBancaInput): Promise<{ banca: Banca } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('bancas')
    .insert({
      nombre: input.nombre,
      tipo: input.tipo,
      moneda: input.moneda,
      descripcion: input.descripcion,
      saldo: 0,
    })
    .select()
    .single();

  if (error || !data) return { error: error?.message ?? 'No se pudo crear la banca.' };
  return { banca: mapBanca(data) };
}

export async function actualizarBanca(
  id: string,
  campos: ActualizarBancaInput
): Promise<{ banca: Banca } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('bancas')
    .update(campos)
    .eq('id', id)
    .select()
    .maybeSingle();

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
    })
    .select()
    .single();

  if (error || !data) return { error: error?.message ?? 'No se pudo registrar el movimiento.' };
  return { movimiento: mapMovimiento(data) };
}
