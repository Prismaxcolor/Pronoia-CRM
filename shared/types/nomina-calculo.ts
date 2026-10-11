/**
 * Cálculo de la nómina semanal para la vista previa en pantalla. COPIA ESPEJO de backend/src/utils/nomina-calculo.ts
 * (la fuente de las fórmulas; el servidor siempre recalcula). backend/tests/nomina-calculo.test.ts exige que ambas den
 * lo mismo: si cambias una, cambia la otra.
 *
 * Fórmulas: bruto = días x monto base; ref. Bs = bruto x tasa; total = bruto + bonificación - (trabajo + préstamo);
 * total Bs = total x tasa; divisas = renglones en USD; Bs = renglones en BS con su equivalente en USD; combinado = suma.
 * Dinero en centavos enteros; todo devuelve valores nuevos.
 */

export const DIAS_MAX_SEMANA = 7;
export type MonedaPago = 'USD' | 'BS';

export interface EntradaLinea {
  diasTrabajados: number;
  montoBaseUsd: number;
  bonificacionUsd: number;
  descuentoTrabajoUsd: number;
  descuentoPrestamoUsd: number;
  monedaPago: MonedaPago;
}

export interface LineaCalculada {
  totalBrutoUsd: number;
  /** null si no hay tasa. */
  montoRefBs: number | null;
  bonificacionUsd: number;
  descuentoTrabajoUsd: number;
  descuentoPrestamoUsd: number;
  descuentosUsd: number;
  totalUsd: number;
  totalBs: number | null;
  negativo: boolean;
  /** Las cuotas de préstamo superan lo ganado del renglón (bruto + bonificación): no es válido. */
  prestamoExcedeGanado: boolean;
}

export interface LineaParaTotales {
  monedaPago: MonedaPago;
  totalUsd: number;
  totalBs: number | null;
}

export interface TotalesNomina {
  cantidad: number;
  cantidadDivisas: number;
  cantidadBs: number;
  totalDivisasUsd: number;
  /** null si hay renglones en Bs y no hay tasa. */
  totalBs: number | null;
  equivalenteUsdDeBs: number;
  totalCombinadoUsd: number;
  /** null si no se puede convertir (falta la tasa). */
  totalCombinadoBs: number | null;
}

const aCentavos = (n: number): number => Math.round(n * 100);
const deCentavos = (c: number): number => c / 100;

/** Bs en centavos de un importe en centavos de USD. */
const bsCentavos = (usdCentavos: number, tasa: number): number => Math.round(usdCentavos * tasa);

/** Bruto del renglón en centavos: días x monto base. */
function brutoCentavos(e: Pick<EntradaLinea, 'diasTrabajados' | 'montoBaseUsd'>): number {
  const centesimasDia = Math.round(e.diasTrabajados * 100);
  return Math.round((aCentavos(e.montoBaseUsd) * centesimasDia) / 100);
}

/** Lo ganado del renglón (USD) = total bruto + bonificación; tope del descuento por préstamo. */
export function gananciaDeLinea(e: Pick<EntradaLinea, 'diasTrabajados' | 'montoBaseUsd' | 'bonificacionUsd'>): number {
  return deCentavos(brutoCentavos(e) + aCentavos(e.bonificacionUsd));
}

/** True si el descuento de préstamo supera lo ganado del renglón (días x monto base + bonificación). */
export function prestamoExcedeGanado(
  e: Pick<EntradaLinea, 'diasTrabajados' | 'montoBaseUsd' | 'bonificacionUsd' | 'descuentoPrestamoUsd'>
): boolean {
  return aCentavos(e.descuentoPrestamoUsd) > brutoCentavos(e) + aCentavos(e.bonificacionUsd);
}

export function calcularLinea(e: EntradaLinea, tasaBs: number | null): LineaCalculada {
  const bruto = brutoCentavos(e);
  const descuentos = aCentavos(e.descuentoTrabajoUsd) + aCentavos(e.descuentoPrestamoUsd);
  const total = bruto + aCentavos(e.bonificacionUsd) - descuentos;
  return {
    totalBrutoUsd: deCentavos(bruto),
    montoRefBs: tasaBs === null ? null : deCentavos(bsCentavos(bruto, tasaBs)),
    bonificacionUsd: e.bonificacionUsd,
    descuentoTrabajoUsd: e.descuentoTrabajoUsd,
    descuentoPrestamoUsd: e.descuentoPrestamoUsd,
    descuentosUsd: deCentavos(descuentos),
    totalUsd: deCentavos(total),
    totalBs: tasaBs === null ? null : deCentavos(bsCentavos(total, tasaBs)),
    negativo: total < 0,
    prestamoExcedeGanado: prestamoExcedeGanado(e),
  };
}

/** Posiciones de los renglones con total negativo (hay que avisar y pedir confirmación explícita). */
export function lineasNegativas(lineas: ReadonlyArray<{ negativo: boolean }>): number[] {
  return lineas.flatMap((l, i) => (l.negativo ? [i] : []));
}

export function calcularTotales(lineas: readonly LineaParaTotales[], tasaBs: number | null): TotalesNomina {
  const usd = lineas.filter(l => l.monedaPago === 'USD');
  const bs = lineas.filter(l => l.monedaPago === 'BS');
  const divisasC = usd.reduce((a, l) => a + aCentavos(l.totalUsd), 0);
  const equivalenteC = bs.reduce((a, l) => a + aCentavos(l.totalUsd), 0);
  const bsSinTasa = bs.some(l => l.totalBs === null);
  const totalBsC = bs.reduce((a, l) => a + aCentavos(l.totalBs ?? 0), 0);
  const divisasEnBsC = tasaBs === null ? null : bsCentavos(divisasC, tasaBs);
  const combinadoBsC = bsSinTasa || (divisasEnBsC === null && usd.length > 0) ? null : totalBsC + (divisasEnBsC ?? 0);
  return {
    cantidad: lineas.length,
    cantidadDivisas: usd.length,
    cantidadBs: bs.length,
    totalDivisasUsd: deCentavos(divisasC),
    totalBs: bsSinTasa ? null : deCentavos(totalBsC),
    equivalenteUsdDeBs: deCentavos(equivalenteC),
    totalCombinadoUsd: deCentavos(divisasC + equivalenteC),
    totalCombinadoBs: combinadoBsC === null ? null : deCentavos(combinadoBsC),
  };
}

/** Total general de la semana: suma los totales de cada tipo de trabajador (cada uno con su propia tasa). */
export function sumarTotales(partes: readonly TotalesNomina[]): TotalesNomina {
  const suma = (f: (t: TotalesNomina) => number): number => partes.reduce((a, t) => a + f(t), 0);
  const sumaCentavos = (f: (t: TotalesNomina) => number): number => partes.reduce((a, t) => a + aCentavos(f(t)), 0);
  const sinBs = partes.some(t => t.totalBs === null);
  const sinCombinado = partes.some(t => t.totalCombinadoBs === null);
  return {
    cantidad: suma(t => t.cantidad),
    cantidadDivisas: suma(t => t.cantidadDivisas),
    cantidadBs: suma(t => t.cantidadBs),
    totalDivisasUsd: deCentavos(sumaCentavos(t => t.totalDivisasUsd)),
    totalBs: sinBs ? null : deCentavos(sumaCentavos(t => t.totalBs ?? 0)),
    equivalenteUsdDeBs: deCentavos(sumaCentavos(t => t.equivalenteUsdDeBs)),
    totalCombinadoUsd: deCentavos(sumaCentavos(t => t.totalCombinadoUsd)),
    totalCombinadoBs: sinCombinado ? null : deCentavos(sumaCentavos(t => t.totalCombinadoBs ?? 0)),
  };
}

// --- Semanas (se identifican por la fecha del lunes, AAAA-MM-DD) ---------------------------------------------------

const FECHA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DIA_MS = 24 * 60 * 60 * 1000;

function parsearFecha(fecha: string): Date | null {
  const m = FECHA_RE.exec(fecha);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const valida = d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
  return valida ? d : null;
}

const aTexto = (d: Date): string => d.toISOString().slice(0, 10);

export function esLunes(fecha: string): boolean {
  return parsearFecha(fecha)?.getUTCDay() === 1;
}

/** Lunes de la semana que contiene la fecha. Lanza si la fecha es inválida. */
export function lunesDe(fecha: string): string {
  const d = parsearFecha(fecha);
  if (!d) throw new Error('Fecha inválida.');
  const retroceso = (d.getUTCDay() + 6) % 7;
  return aTexto(new Date(d.getTime() - retroceso * DIA_MS));
}

/** Domingo de la semana que empieza en ese lunes. */
export function domingoDe(lunes: string): string {
  const d = parsearFecha(lunes);
  if (!d) throw new Error('Fecha inválida.');
  return aTexto(new Date(d.getTime() + 6 * DIA_MS));
}

// --- Préstamos ------------------------------------------------------------------------------------------------------

export interface PrestamoParaCuota {
  saldoUsd: number;
  cuotaSemanalUsd: number | null;
}

/** Cuota que se propone: la semanal del préstamo, sin pasar del saldo. Sin cuota semanal no se propone nada. */
export function cuotaSugerida(p: PrestamoParaCuota): number {
  if (p.cuotaSemanalUsd === null) return 0;
  return deCentavos(Math.min(aCentavos(p.cuotaSemanalUsd), aCentavos(p.saldoUsd)));
}

export function sumarCuotas(cuotas: ReadonlyArray<{ montoUsd: number }>): number {
  return deCentavos(cuotas.reduce((a, c) => a + aCentavos(c.montoUsd), 0));
}

export interface PrestamoVigente {
  id: string;
  trabajadorId: string;
  saldoUsd: number;
  estado: string;
}

export interface LineaConCuotas {
  trabajadorId: string;
  cuotas: ReadonlyArray<{ prestamoId: string; montoUsd: number }>;
}

/** null si todas las cuotas son válidas; si no, el mensaje (en español) del primer problema. */
export function validarCuotas(lineas: readonly LineaConCuotas[], prestamos: readonly PrestamoVigente[]): string | null {
  const porId = new Map(prestamos.map(p => [p.id, p]));
  for (const linea of lineas) {
    for (const c of linea.cuotas) {
      const p = porId.get(c.prestamoId);
      if (!p) return 'Un préstamo de los descuentos no existe.';
      if (p.trabajadorId !== linea.trabajadorId) return 'Un préstamo no es de este trabajador.';
      if (p.estado !== 'ACTIVO') return 'Un préstamo de los descuentos ya no está activo.';
      if (aCentavos(c.montoUsd) > aCentavos(p.saldoUsd)) return 'Una cuota supera el saldo pendiente del préstamo.';
    }
  }
  return null;
}
