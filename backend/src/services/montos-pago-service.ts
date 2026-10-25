import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { validarCoherenciaMonto, type LineaMonto } from '../utils/coherencia-monto-pago.js';

/** Cuántas capturas recientes se leen para quedarse con la última de cada fuente (BCV, Binance). */
const CAPTURAS_RECIENTES = 20;

interface FilaTasa {
  fuente: string;
  tasa: number | string;
  fecha: string;
}

/** Última tasa USD→VES de cada fuente (BCV y Binance) de `tasas_cambio`. Vacío si no hay datos o falla la lectura:
 *  entonces no se cruza contra la tasa y solo rigen las reglas propias de cada línea (nunca se bloquea un pago por esto). */
export async function tasasUsdVesVigentes(): Promise<number[]> {
  try {
    return await leerTasasUsdVes();
  } catch (e) {
    logger.warn({ evento: 'pago_tasas_no_disponibles', mensaje: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

async function leerTasasUsdVes(): Promise<number[]> {
  const { data, error } = await supabaseAdmin
    .from('tasas_cambio')
    .select('fuente, tasa, fecha')
    .eq('moneda_origen', 'USD')
    .eq('moneda_destino', 'VES')
    .order('fecha', { ascending: false })
    .limit(CAPTURAS_RECIENTES);
  if (error) {
    logger.warn({ evento: 'pago_tasas_no_disponibles', mensaje: error.message });
    return [];
  }
  const ultimaPorFuente = new Map<string, number>();
  for (const fila of (data ?? []) as FilaTasa[]) {
    const tasa = Number(fila.tasa);
    if (!ultimaPorFuente.has(fila.fuente) && Number.isFinite(tasa) && tasa > 0) ultimaPorFuente.set(fila.fuente, tasa);
  }
  return [...ultimaPorFuente.values()];
}

/**
 * Valida la coherencia de montos de las líneas de un pago o cobro ANTES de mover dinero. Devuelve el primer mensaje
 * de rechazo o null. Solo consulta las tasas si alguna línea está en Bs.
 */
export async function validarMontosDeLineas(lineas: readonly LineaMonto[]): Promise<string | null> {
  const hayBs = lineas.some(l => l.moneda === 'VES');
  const tasasVigentes = hayBs ? await tasasUsdVesVigentes() : [];
  if (hayBs && tasasVigentes.length === 0) {
    logger.warn({ evento: 'pago_monto_sin_tasa_vigente', mensaje: 'Sin tasa en tasas_cambio: no se cruza el monto en Bs' });
  }
  for (const linea of lineas) {
    const rechazo = validarCoherenciaMonto(linea, { tasasVigentes });
    if (rechazo) return rechazo;
  }
  return null;
}
