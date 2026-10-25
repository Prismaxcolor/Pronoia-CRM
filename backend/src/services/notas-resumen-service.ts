import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { leerPaginado } from '../utils/paginacion.js';

/**
 * Totales de las notas de crédito y débito VIGENTES (no anuladas) de los clientes en un periodo.
 * Alimenta el indicador "Emitido sin registro de cobros" de Ventas, que debe sumar las notas de débito y restar las
 * de crédito además de las facturas emitidas. Todo en USD; una nota aplicada a un cobro sigue contando (aplicar una
 * nota no cambia lo que se emitió).
 */

export interface ResumenNotasVenta {
  /** Suma de las notas de débito vigentes (suben lo emitido). */
  notasDebito: number;
  /** Suma de las notas de crédito vigentes (bajan lo emitido). */
  notasCredito: number;
  cantidadDebito: number;
  cantidadCredito: number;
}

export interface NotaParaResumen { tipo: 'credito' | 'debito'; monto: number | string; anulada: boolean }

const aCentavos = (n: number): number => Math.round(n * 100);

/** Función pura: suma por tipo las notas no anuladas, en centavos enteros. */
export function resumirNotasVenta(notas: readonly NotaParaResumen[]): ResumenNotasVenta {
  let debito = 0;
  let credito = 0;
  let cantidadDebito = 0;
  let cantidadCredito = 0;
  for (const n of notas) {
    if (n.anulada) continue;
    const centavos = aCentavos(Number(n.monto));
    if (!Number.isFinite(centavos)) continue;
    if (n.tipo === 'debito') { debito += centavos; cantidadDebito += 1; } else { credito += centavos; cantidadCredito += 1; }
  }
  return { notasDebito: debito / 100, notasCredito: credito / 100, cantidadDebito, cantidadCredito };
}

/** Lee las notas de clientes del periodo (por su fecha) y las resume. Lanza si la lectura falla: sin cifras parciales. */
export async function obtenerResumenNotasVenta(desde?: string, hasta?: string): Promise<ResumenNotasVenta> {
  const filas = await leerPaginado<NotaParaResumen>((d, h) => {
    let q = supabaseAdmin.from('notas_ajuste_cliente').select('id, tipo, monto, anulada').eq('anulada', false);
    if (desde) q = q.gte('fecha', desde);
    if (hasta) q = q.lte('fecha', hasta);
    return q.order('id', { ascending: true }).range(d, h);
  });
  return resumirNotasVenta(filas);
}

export async function resumenNotasVentaONull(desde?: string, hasta?: string): Promise<ResumenNotasVenta | null> {
  try {
    return await obtenerResumenNotasVenta(desde, hasta);
  } catch (e) {
    logger.error({ evento: 'notas_resumen_venta_fallo', mensaje: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
