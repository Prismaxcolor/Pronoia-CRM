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

export async function obtenerBancas(): Promise<Banca[]> {
  const { data, error } = await supabase
    .from('bancas')
    .select('*')
    .order('nombre');

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

export interface EliminarBancaResult {
  ok: boolean;
  razon?: string;
}

/** Elimina una banca. Falla si tiene movimientos asociados o saldo distinto de 0. */
export async function eliminarBanca(id: string, saldoActual: number): Promise<EliminarBancaResult> {
  if (Math.abs(saldoActual) > 0.001) {
    return { ok: false, razon: 'No se puede eliminar una banca con saldo distinto de 0. Transfiere o retira los fondos primero.' };
  }

  const { count } = await supabase
    .from('movimientos')
    .select('id', { count: 'exact', head: true })
    .or(`banca_origen_id.eq.${id},banca_destino_id.eq.${id}`);

  if (count && count > 0) {
    return { ok: false, razon: `La banca tiene ${count} movimiento${count > 1 ? 's' : ''} en su historial. Elimina/anula los movimientos antes de borrar la banca.` };
  }

  const { error } = await supabase
    .from('bancas')
    .delete()
    .eq('id', id);

  if (error) return { ok: false, razon: error.message };
  return { ok: true };
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
    })
    .select()
    .single();

  if (error || !data) {
    console.error('Error al crear movimiento:', error);
    return null;
  }

  return mapMovimiento(data);
}
