/**
 * Equivalente en USD de un importe en Bs de un movimiento (puro, sin BD).
 * Prioridad: monto_usd guardado en el movimiento (tasa del momento del pago/cobro); si no existe, la tasa
 * histórica USD->VES más cercana que no sea posterior al movimiento; si tampoco hay, null (nunca se inventa).
 */
export interface TasaHistorica {
  /** Bs por 1 USD. */
  tasa: number;
  fecha: string;
  fuente?: string;
}

export interface DatosEquivalente {
  moneda: string;
  monto: number;
  montoUsd?: number | null;
  fecha: string;
  /** El importe de la cuenta se expresa en la moneda y monto del movimiento (origen, ingreso o egreso). */
  importeEnMonedaOrigen: boolean;
}

const MONEDA_BS = 'VES';
const FUENTE_PREFERIDA = 'BCV';
const MS_POR_HORA = 3_600_000;
const HORAS_POR_DIA = 24;
/** Caracas está en UTC-4 todo el año: su día D termina a las 04:00 UTC del día D+1. */
const DESFASE_CARACAS_HORAS = 4;
const LARGO_FECHA_DIA = 10;

const redondear2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Último milisegundo del día `dia` (YYYY-MM-DD) en hora de Caracas, como instante UTC. */
export function finDeDiaCaracas(dia: string): number {
  return Date.parse(`${dia}T00:00:00Z`) + (HORAS_POR_DIA + DESFASE_CARACAS_HORAS) * MS_POR_HORA - 1;
}

/** Instante del movimiento; si solo trae el día se toma el final de ese día (hora de Caracas). */
function instante(fecha: string): number {
  return fecha.length <= LARGO_FECHA_DIA ? finDeDiaCaracas(fecha) : Date.parse(fecha);
}

function masCercana(tasas: readonly TasaHistorica[], limite: number): TasaHistorica | null {
  return tasas.reduce<TasaHistorica | null>((mejor, t) => {
    const ms = Date.parse(t.fecha);
    if (!Number.isFinite(ms) || ms > limite || !(t.tasa > 0)) return mejor;
    return mejor === null || ms > Date.parse(mejor.fecha) ? t : mejor;
  }, null);
}

/** Tasa (Bs por USD) vigente a la fecha dada: la más reciente <= fecha, prefiriendo BCV; null si no hay ninguna. */
export function tasaVigenteA(tasas: readonly TasaHistorica[], fecha: string): number | null {
  const limite = instante(fecha);
  if (!Number.isFinite(limite)) return null;
  const bcv = masCercana(tasas.filter(t => t.fuente === FUENTE_PREFERIDA), limite);
  return (bcv ?? masCercana(tasas, limite))?.tasa ?? null;
}

/** Equivalente en USD de `importe` (Bs) o null si no se puede determinar. */
export function equivalenteUsd(importe: number, d: DatosEquivalente, tasas: readonly TasaHistorica[]): number | null {
  if (!(importe > 0)) return null;
  if (d.importeEnMonedaOrigen && d.moneda === MONEDA_BS && d.montoUsd != null && d.montoUsd > 0 && d.monto > 0) {
    return redondear2((d.montoUsd * importe) / d.monto);
  }
  const tasa = tasaVigenteA(tasas, d.fecha);
  return tasa === null ? null : redondear2(importe / tasa);
}
