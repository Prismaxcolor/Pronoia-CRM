/**
 * Antigüedad ESTIMADA del stock actual: lógica pura, sin BD.
 *
 * No hay capas FIFO: el sistema no sabe de qué entrada salió cada kilo vendido. Se asume que el stock
 * actual se formó con las entradas MÁS RECIENTES (compras, salidas de transformación y ajustes positivos
 * de toma física, con su fecha) y se pondera por kg. Los datos solo existen desde 2026-09-16: lo que
 * ninguna entrada registrada explica NO recibe fecha inventada, queda en kgSinFecha.
 */
import type { AntiguedadEstimada } from '../../../shared/types/inventario-pantalla.js';

export interface EntradaFechada {
  /** YYYY-MM-DD (o ISO: se usan los 10 primeros caracteres). */
  fecha: string;
  kg: number;
  /** Almacén donde entró (para filtrar por almacén). null/ausente = no se sabe. */
  almacenId?: string | null;
}

const DIA_MS = 86_400_000;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const redondear = (n: number, d: number): number => Math.round((n + Number.EPSILON) * 10 ** d) / 10 ** d + 0;

const aMs = (fecha: string): number => Date.parse(`${fecha}T00:00:00.000Z`);

/** Días calendario entre `desde` y `hasta`; nunca negativo. */
export function diasEntre(desde: string, hasta: string): number {
  return Math.max(Math.round((aMs(hasta) - aMs(desde)) / DIA_MS), 0);
}

export function antiguedadEstimada(
  stockKg: number,
  entradas: readonly EntradaFechada[],
  hoy: string
): AntiguedadEstimada | null {
  if (!Number.isFinite(stockKg) || stockKg <= 0.005) return null;
  const porFecha = new Map<string, number>();
  for (const e of entradas) {
    const dia = String(e.fecha ?? '').slice(0, 10);
    if (!FECHA.test(dia) || !Number.isFinite(e.kg) || e.kg <= 0) continue;
    porFecha.set(dia, (porFecha.get(dia) ?? 0) + e.kg);
  }
  const recientesPrimero = [...porFecha.entries()].sort(([a], [b]) => b.localeCompare(a));

  let restante = stockKg;
  let sumaDias = 0;
  let consumido = 0;
  let masAntigua = '';
  let masReciente = '';
  for (const [fecha, kg] of recientesPrimero) {
    if (restante <= 0) break;
    const usado = Math.min(kg, restante);
    restante -= usado;
    consumido += usado;
    sumaDias += usado * diasEntre(fecha, hoy);
    masAntigua = fecha;
    if (!masReciente) masReciente = fecha;
  }
  if (consumido <= 0) return null;
  return {
    estimado: true,
    diasPromedio: redondear(sumaDias / consumido, 1),
    fechaEntradaMasAntigua: masAntigua,
    fechaEntradaMasReciente: masReciente,
    kgConFecha: redondear(consumido, 3),
    kgSinFecha: redondear(Math.max(stockKg - consumido, 0), 3),
  };
}

/** Une antigüedades de varias filas (para una tarjeta): promedio ponderado por los kg que tienen fecha. */
export function combinarAntiguedades(lista: ReadonlyArray<AntiguedadEstimada | null>): AntiguedadEstimada | null {
  const validas = lista.filter((a): a is AntiguedadEstimada => a != null && a.kgConFecha > 0);
  if (validas.length === 0) return null;
  const kgConFecha = validas.reduce((s, a) => s + a.kgConFecha, 0);
  return {
    estimado: true,
    diasPromedio: redondear(validas.reduce((s, a) => s + a.diasPromedio * a.kgConFecha, 0) / kgConFecha, 1),
    fechaEntradaMasAntigua: validas.map(a => a.fechaEntradaMasAntigua).sort()[0],
    fechaEntradaMasReciente: validas.map(a => a.fechaEntradaMasReciente).sort().at(-1) as string,
    kgConFecha: redondear(kgConFecha, 3),
    kgSinFecha: redondear(validas.reduce((s, a) => s + a.kgSinFecha, 0), 3),
  };
}
