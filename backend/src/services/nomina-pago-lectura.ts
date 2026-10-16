import { supabaseAdmin } from '../config/supabase.js';
import { esObjetoInexistente } from '../utils/migracion-pendiente.js';
import { falloNomina, type FalloNomina } from '../utils/nomina-errores.js';
import type { PagoNomina } from '../../../shared/types/nomina.js';

type Fila = Record<string, unknown>;

const COLUMNAS_PAGO = '*, banca:bancas(nombre), movimiento:movimientos(numero_sistema, anulado, comprobantes)';

/** Renglón (id) -> trabajador, para saber a quién se pagó cada pago individual. */
export type TrabajadorPorLinea = ReadonlyMap<string, string>;

function mapPago(row: Fila, trabajadorPorLinea: TrabajadorPorLinea): PagoNomina {
  const banca = row.banca as Fila | null;
  const movimiento = row.movimiento as Fila | null;
  // linea_id solo existe con la migración del pago por trabajador; sin ella (o en un pago de toda la nómina) es null.
  const lineaId = (row.linea_id as string | null | undefined) ?? null;
  return {
    id: row.id as string,
    trabajadorId: lineaId === null ? null : trabajadorPorLinea.get(lineaId) ?? null,
    comprobantes: (movimiento?.comprobantes as string[] | null | undefined) ?? [],
    monedaPago: row.moneda_pago as PagoNomina['monedaPago'],
    bancaId: row.banca_id as string,
    bancaNombre: (banca?.nombre as string | undefined) ?? '',
    movimientoId: row.movimiento_id as string,
    movimientoNumero: movimiento?.numero_sistema == null ? null : Number(movimiento.numero_sistema),
    anulado: Boolean(movimiento?.anulado),
    monto: Number(row.monto),
    montoUsd: Number(row.monto_usd),
    cantidad: Number(row.cantidad),
    fecha: row.fecha as string,
    referencia: (row.referencia as string | null) ?? null,
    pagadoEn: row.created_at as string,
    tasaBinance: row.tasa_binance == null ? null : Number(row.tasa_binance),
    tasaBinanceCapturada: (row.tasa_binance_capturada as string | null) ?? null,
    equivalenteBinanceUsd: row.equivalente_binance_usd == null ? null : Number(row.equivalente_binance_usd),
  };
}

/**
 * Pagos de una nómina desde el Wallet (de toda la nómina o de cada trabajador). Si la migración del pago aún no está
 * aplicada devuelve lista vacía (la nómina se ve como siempre); un fallo real de la BD sí se propaga: mostrar "sin pagar"
 * por un error invitaría a pagar de nuevo.
 */
export async function pagosDeNomina(
  nominaId: string, trabajadorPorLinea: TrabajadorPorLinea = new Map(),
): Promise<{ pagos: PagoNomina[] } | FalloNomina> {
  const { data, error } = await supabaseAdmin.from('nomina_pagos').select(COLUMNAS_PAGO).eq('nomina_id', nominaId).order('moneda_pago');
  if (error) {
    if (esObjetoInexistente(error)) return { pagos: [] };
    return falloNomina(error, 'nomina_pagos_leer', 'No se pudo cargar el pago de la nómina.');
  }
  return { pagos: ((data as unknown as Fila[] | null) ?? []).map(f => mapPago(f, trabajadorPorLinea)) };
}

/**
 * Ids de las cuentas (bancas) con que se pagó una nómina; [] si no está pagada o la migración del pago no está
 * aplicada. Lanza si la BD falla: quien autoriza debe fallar cerrado, no tratar el error como "sin pago".
 */
export async function bancasDePagoNomina(nominaId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin.from('nomina_pagos').select('banca_id').eq('nomina_id', nominaId);
  if (error) {
    if (esObjetoInexistente(error)) return [];
    throw new Error(error.message);
  }
  return [...new Set(((data as Array<{ banca_id: string }> | null) ?? []).map(f => f.banca_id))];
}
