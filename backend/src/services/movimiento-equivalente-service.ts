import { supabaseAdmin } from '../config/supabase.js';
import { leerPaginado } from '../utils/paginacion.js';
import { logger } from '../utils/logger.js';
import { aplicarEquivalentes, type MovimientoConEquivalente, type TasaHistorica } from '../utils/equivalente-movimiento.js';

/** Capturas anteriores a la fecha más antigua que se leen para tener la tasa vigente en ese momento. */
const TASAS_PREVIAS = 20;
const FUENTES = ['Binance', 'BCV'];

type Fila = Record<string, unknown>;

function aTasas(filas: readonly Fila[]): TasaHistorica[] {
  return filas
    .map(r => ({ tasa: Number(r.tasa), fecha: String(r.fecha ?? ''), fuente: r.fuente as string | undefined }))
    .filter(t => t.tasa > 0 && t.fecha !== '');
}

/** Tasas USD->VES (Binance y BCV) desde `desde` (YYYY-MM-DD) más las últimas anteriores a esa fecha. */
async function leerTasasDesde(desde: string): Promise<TasaHistorica[]> {
  const base = () => supabaseAdmin.from('tasas_cambio').select('tasa, fecha, fuente')
    .eq('moneda_origen', 'USD').eq('moneda_destino', 'VES').in('fuente', FUENTES);
  const [enRango, previas] = await Promise.all([
    leerPaginado<Fila>((d, h) => base().gte('fecha', desde).order('fecha', { ascending: false }).range(d, h)),
    base().lt('fecha', desde).order('fecha', { ascending: false }).limit(TASAS_PREVIAS),
  ]);
  return [...aTasas(enRango), ...aTasas((previas.data as Fila[] | null) ?? [])];
}

/**
 * Agrega `equivalenteUsd` (tasa Binance del momento del movimiento) a los movimientos en Bs sin `montoUsd` guardado.
 * Si la lectura de tasas falla, devuelve los movimientos tal cual: el equivalente queda ausente (no se inventa).
 */
export async function conEquivalenteUsd<T extends MovimientoConEquivalente>(movimientos: readonly T[]): Promise<T[]> {
  const pendientes = movimientos.filter(m => m.moneda === 'VES' && m.montoUsd == null);
  if (pendientes.length === 0) return [...movimientos];
  try {
    const masAntigua = pendientes.reduce((min, m) => (m.fecha.slice(0, 10) < min ? m.fecha.slice(0, 10) : min), pendientes[0].fecha.slice(0, 10));
    return aplicarEquivalentes(movimientos, await leerTasasDesde(masAntigua));
  } catch (e) {
    logger.warn({ evento: 'movimientos_sin_tasas', mensaje: e instanceof Error ? e.message : String(e) });
    return [...movimientos];
  }
}
