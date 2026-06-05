import { supabase } from '../config/supabase';
import type { Banca, Movimiento, TipoMovimiento, TipoBanca } from '@shared/types/index.js';

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
    creadoEn: row.creado_en as string,
  };
}

export interface ObtenerBancasOpts {
  incluirArchivadas?: boolean;
}

export async function obtenerBancas(opts: ObtenerBancasOpts = {}): Promise<Banca[]> {
  let query = supabase.from('bancas').select('*').order('nombre');
  if (!opts.incluirArchivadas) {
    query = query.eq('archivada', false);
  }
  const { data, error } = await query;
  if (error || !data) return [];
  return data.map(mapBanca);
}

export async function obtenerMovimientos(): Promise<Movimiento[]> {
  const { data, error } = await supabase
    .from('movimientos')
    .select('*')
    .order('creado_en', { ascending: false });

  if (error || !data) return [];
  return data.map(mapMovimiento);
}

export interface CrearBancaInput {
  nombre: string;
  tipo: TipoBanca;
  moneda: string;
  descripcion: string;
}

/** Crea una banca con saldo 0. Para establecer saldo inicial se debe registrar un ingreso. */
export async function crearBanca(input: CrearBancaInput): Promise<Banca | null> {
  const { data, error } = await supabase
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

  if (error || !data) {
    console.error('Error al crear banca:', error);
    return null;
  }
  return mapBanca(data);
}

export interface ActualizarBancaInput {
  nombre?: string;
  tipo?: TipoBanca;
  descripcion?: string;
}

export async function actualizarBanca(id: string, campos: ActualizarBancaInput): Promise<boolean> {
  const { error } = await supabase
    .from('bancas')
    .update(campos)
    .eq('id', id);
  return !error;
}

export interface ArchivarBancaResult {
  ok: boolean;
  razon?: string;
}

/**
 * Archiva una banca (soft delete). Falla si tiene saldo distinto de 0.
 * No se permite borrar físicamente: la regla de dominio del CLAUDE.md es
 * "en finanzas NUNCA se borra; se reversa con un movimiento contrario".
 */
export async function archivarBanca(id: string, saldoActual: number): Promise<ArchivarBancaResult> {
  if (Math.abs(saldoActual) > 0.001) {
    return {
      ok: false,
      razon: 'No se puede archivar una banca con saldo distinto de 0. Transfiere o retira los fondos primero.',
    };
  }

  const { error } = await supabase
    .from('bancas')
    .update({ archivada: true, archivada_en: new Date().toISOString() })
    .eq('id', id);

  if (error) return { ok: false, razon: error.message };
  return { ok: true };
}

export async function desarchivarBanca(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('bancas')
    .update({ archivada: false, archivada_en: null })
    .eq('id', id);
  return !error;
}

export interface CrearMovimientoInput {
  tipo: 'ingreso' | 'egreso';
  bancaId: string;
  monto: number;
  moneda: string;
  descripcion: string;
  referencia: string;
  fecha: string;
  registradoPor: string;
  /** Proveedor al que se le paga (egreso). Alimenta su estado de cuenta. */
  proveedorId?: string | null;
  /** Cliente del que se cobra (ingreso). Alimenta su estado de cuenta. */
  clienteId?: string | null;
}

/** Crea un movimiento de ingreso o egreso. El trigger SQL ajusta el saldo. */
export async function crearMovimiento(input: CrearMovimientoInput): Promise<Movimiento | null> {
  const { data, error } = await supabase
    .from('movimientos')
    .insert({
      tipo: input.tipo,
      monto: input.monto,
      moneda: input.moneda,
      descripcion: input.descripcion,
      banca_origen_id: input.bancaId,
      banca_destino_id: null,
      fecha: input.fecha,
      referencia: input.referencia,
      registrado_por: input.registradoPor,
      proveedor_id: input.proveedorId ?? null,
      cliente_id: input.clienteId ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    console.error('Error al crear movimiento:', error);
    return null;
  }

  return mapMovimiento(data);
}
