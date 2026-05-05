import { supabase } from '../config/supabase';
import { BANCAS_MOCK, MOVIMIENTOS_MOCK } from './mock-data';
import type { Banca, Movimiento } from '@shared/types/index.js';

export async function obtenerBancas(): Promise<Banca[]> {
  const { data, error } = await supabase
    .from('bancas')
    .select('*');

  if (error || !data) return BANCAS_MOCK;
  return data.map(row => ({
    id: row.id,
    nombre: row.nombre,
    saldo: row.saldo,
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
  return data.map(row => ({
    id: row.id,
    tipo: row.tipo,
    monto: row.monto,
    moneda: row.moneda,
    descripcion: row.descripcion,
    bancaOrigenId: row.banca_origen_id,
    bancaDestinoId: row.banca_destino_id,
    fecha: row.fecha,
    referencia: row.referencia,
    registradoPor: row.registrado_por ?? '',
    creadoEn: row.creado_en,
  }));
}
