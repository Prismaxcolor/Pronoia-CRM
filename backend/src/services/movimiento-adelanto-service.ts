import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { subtipoAdelantoDeMovimiento, type DatosMovimientoEntidad } from '../utils/movimiento-adelanto.js';

/**
 * USD de un adelanto/anticipo registrado desde Wallet.
 *
 * El estado de cuenta de proveedores y clientes se lleva en USD y toma `monto_usd` de cada movimiento (o `monto` si no
 * lo tiene). Un movimiento de Wallet en USD ya está en dólares; uno en Bs se convertiría mal (Bs tratados como USD), así
 * que al nacer como adelanto/anticipo se guarda su equivalente: Bs / tasa USD->VES vigente, prefiriendo Binance (la misma
 * que Wallet muestra como equivalente) y, si no hay, BCV. Sin tasa o en otra moneda no se registra: se pide hacerlo desde
 * "Registrar pago" del estado de cuenta, donde se elige la tasa. La RPC SQL de comisión repite esta regla.
 */

export const MENSAJE_ADELANTO_SIN_TASA =
  'No hay una tasa de cambio disponible para convertir el movimiento a USD. Registra el pago desde el estado de cuenta (donde eliges la tasa) o intenta de nuevo cuando haya tasa.';
export const MENSAJE_ADELANTO_MONEDA =
  'Un adelanto o anticipo solo se puede registrar desde una cuenta en USD o en Bs. Usa "Registrar pago" en el estado de cuenta.';

const FUENTES_EN_ORDEN = ['Binance', 'BCV'] as const;

export type ResultadoEquivalenteAdelanto = { montoUsd: number | null } | { error: string };

/** Bs / tasa, a centavos (mitad hacia arriba, sin error de coma flotante). */
export function usdDeBs(montoBs: number, tasa: number): number {
  return Math.round(Number(((montoBs / tasa) * 100).toPrecision(15))) / 100;
}

async function ultimaTasa(fuente: string): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from('tasas_cambio')
    .select('tasa')
    .eq('moneda_origen', 'USD')
    .eq('moneda_destino', 'VES')
    .eq('fuente', fuente)
    .gt('tasa', 0)
    .order('fecha', { ascending: false })
    .limit(1);
  if (error) {
    logger.warn({ evento: 'adelanto_wallet_tasa_no_disponible', fuente, mensaje: error.message });
    return null;
  }
  const tasa = Number((data as Array<{ tasa: unknown }> | null)?.[0]?.tasa);
  return Number.isFinite(tasa) && tasa > 0 ? tasa : null;
}

/**
 * `montoUsd: null` = no hay nada que guardar (no es un adelanto/anticipo, o la cuenta ya es en USD). Si es un adelanto
 * desde una cuenta en Bs devuelve el equivalente; si no se puede calcular, el motivo del rechazo.
 */
export async function equivalenteUsdParaAdelanto(
  movimiento: DatosMovimientoEntidad & { moneda: string; monto: number }
): Promise<ResultadoEquivalenteAdelanto> {
  if (!subtipoAdelantoDeMovimiento(movimiento)) return { montoUsd: null };
  if (movimiento.moneda === 'USD') return { montoUsd: null };
  if (movimiento.moneda !== 'VES') return { error: MENSAJE_ADELANTO_MONEDA };
  for (const fuente of FUENTES_EN_ORDEN) {
    const tasa = await ultimaTasa(fuente);
    if (tasa) return { montoUsd: usdDeBs(movimiento.monto, tasa) };
  }
  return { error: MENSAJE_ADELANTO_SIN_TASA };
}
