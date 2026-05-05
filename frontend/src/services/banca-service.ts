import { supabase } from '../config/supabase';
import { BANCAS_MOCK, MOVIMIENTOS_MOCK } from './mock-data';
import type { Banca, Movimiento, TipoMovimiento } from '@shared/types/index.js';

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
    .select('*');

  if (error || !data) return BANCAS_MOCK;
  return data.map(row => ({
    id: row.id,
    nombre: row.nombre,
    saldo: Number(row.saldo),
    moneda: row.moneda,
    descripcion: row.descripcion,
  }));
}

export async function obtenerMovimientos(): Promise<Movimiento[]> {
  const { data, error } = await supabase
    .from('movimientos')
    .select('*')
    .order('creado_en', { ascending: false });

  if (error || !data) return MOVIMIENTOS_MOCK;
  return data.map(mapMovimiento);
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
