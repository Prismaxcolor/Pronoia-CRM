/**
 * Cálculo de la nómina semanal: LA ÚNICA fuente de las fórmulas (lógica pura, sin base de datos).
 * Copia espejo para la vista previa en pantalla: shared/types/nomina-calculo.ts (el alias @shared no resuelve en
 * runtime del backend). backend/tests/nomina-calculo.test.ts exige que ambas den lo mismo: si cambias una, cambia la otra.
 *
 * FÓRMULAS (supuestos acordados con el cliente; para cambiarlas basta editar este archivo). Cada trabajador tiene DOS
 * sueldos diarios y puede cobrar las dos partes en la misma semana:
 *   sueldo en divisas (USD)  : se paga en efectivo o Binance        -> montoBaseUsd, por día
 *   sueldo en Bs             : la otra parte, pagada en bolívares    -> montoBaseBs, por día (se guarda en Bs)
 *
 *   bruto divisas (USD)  = días x montoBaseUsd            bruto Bs = días x montoBaseBs
 *   total bruto USD      = bruto divisas + bruto Bs / tasa (sin sueldo en Bs es igual al bruto de divisas)
 *   ganado en divisas    = bruto divisas + bonificación (la bonificación extra se paga siempre en divisas)
 *   descuentos (USD)     = descuento por trabajo + cuotas de préstamo
 *   Los descuentos se cargan PRIMERO contra la parte en divisas. Si el trabajador tiene sueldo en Bs y la parte en
 *   divisas no alcanza, el sobrante (en USD) se descuenta de la parte en Bs a la tasa de la nómina. Sin sueldo en Bs
 *   no hay a dónde cargar el sobrante: el total en divisas queda negativo (se avisa y no se puede cerrar).
 *   a pagar en divisas   = ganado en divisas - descuentos cargados a divisas
 *   a pagar en Bs        = bruto Bs - sobrante x tasa
 *   total del trabajador = a pagar en divisas + (a pagar en Bs / tasa)                (USD)
 *   total en Bs (ref.)   = total del trabajador x tasa
 *   Totales de la nómina: divisas = suma de "a pagar en divisas"; Bs = suma de "a pagar en Bs"; su equivalente en USD =
 *   suma de los equivalentes de cada renglón (sin dividir de vuelta el total, para no arrastrar redondeo);
 *   combinado USD = divisas + equivalente;  combinado Bs = Bs + divisas x tasa.
 *   Con parte en Bs la tasa es obligatoria (sin ella los montos en Bs salen null y `faltaTasa` es true).
 *
 * Todo el dinero se calcula en centavos enteros (sin error de coma flotante) y todo devuelve valores nuevos.
 */

export const DIAS_MAX_SEMANA = 7;
export type MonedaPago = 'USD' | 'BS';
/** Cómo cobra un trabajador esa semana: solo divisas, solo bolívares o las dos partes. */
export type MonedaLinea = MonedaPago | 'MIXTO';

export interface EntradaLinea {
  diasTrabajados: number;
  /** Sueldo diario en divisas (USD). */
  montoBaseUsd: number;
  /** Sueldo diario en bolívares (Bs). */
  montoBaseBs: number;
  bonificacionUsd: number;
  descuentoTrabajoUsd: number;
  descuentoPrestamoUsd: number;
}

export interface LineaCalculada {
  /** Bruto total en USD: divisas + (bruto Bs / tasa). Sin sueldo en Bs es solo el bruto de divisas. */
  totalBrutoUsd: number;
  /** Bruto de la parte en Bs. */
  brutoBs: number;
  /** Bruto total expresado en Bs (divisas x tasa + bruto Bs); null si no hay tasa. */
  montoRefBs: number | null;
  bonificacionUsd: number;
  descuentoTrabajoUsd: number;
  descuentoPrestamoUsd: number;
  descuentosUsd: number;
  /** Lo que se paga en divisas (USD). */
  pagarUsd: number;
  /** Lo que se paga en Bs; null si hay parte en Bs y falta la tasa. */
  pagarBs: number | null;
  /** Lo que valen en USD los Bs a pagar; null si falta la tasa. */
  equivalenteBsUsd: number | null;
  /** Total del trabajador en USD (divisas + equivalente de los Bs). */
  totalUsd: number;
  /** Total del trabajador en Bs de referencia (totalUsd x tasa); null si no hay tasa. */
  totalBs: number | null;
  monedaPago: MonedaLinea;
  negativo: boolean;
  /** Las cuotas de préstamo superan lo ganado del renglón (bruto + bonificación): no es válido. */
  prestamoExcedeGanado: boolean;
  /** Hay parte en Bs y no hay tasa: no se puede calcular ni guardar. */
  faltaTasa: boolean;
}

export interface LineaParaTotales {
  pagarUsd: number;
  pagarBs: number | null;
  equivalenteBsUsd: number | null;
}

export interface TotalesNomina {
  cantidad: number;
  /** Trabajadores con algo que cobrar en divisas (uno con las dos partes cuenta en ambos grupos). */
  cantidadDivisas: number;
  cantidadBs: number;
  totalDivisasUsd: number;
  /** null si hay renglones con parte en Bs y no hay tasa. */
  totalBs: number | null;
  equivalenteUsdDeBs: number;
  totalCombinadoUsd: number;
  /** null si no se puede convertir (falta la tasa). */
  totalCombinadoBs: number | null;
}

const aCentavos = (n: number): number => Math.round(n * 100);
const deCentavos = (c: number): number => c / 100;

/** Bs en centavos de un importe en centavos de USD. */
const bsCentavos = (usdCentavosMonto: number, tasa: number): number => Math.round(usdCentavosMonto * tasa);

/** USD en centavos de un importe en centavos de Bs. */
const usdCentavos = (bsCentavosMonto: number, tasa: number): number => Math.round(bsCentavosMonto / tasa);

/** Lo que valen en USD unos bolívares a una tasa (Bs por USD), redondeado al centavo. Lanza si la tasa no es positiva. */
export function equivalenteUsdDeBs(montoBs: number, tasa: number): number {
  if (!(tasa > 0)) throw new Error('La tasa debe ser mayor a 0.');
  return deCentavos(usdCentavos(aCentavos(montoBs), tasa));
}

/** Bruto de un sueldo diario en centavos: días x sueldo (en la unidad del sueldo, USD o Bs). */
function brutoCentavos(dias: number, sueldoDiario: number): number {
  const centesimasDia = Math.round(dias * 100);
  return Math.round((aCentavos(sueldoDiario) * centesimasDia) / 100);
}

type EntradaGanado = Pick<EntradaLinea, 'diasTrabajados' | 'montoBaseUsd' | 'montoBaseBs' | 'bonificacionUsd'>;

/** Ganado total en centavos de USD (divisas + bonificación + Bs/tasa); null si hay Bs y falta la tasa. */
function ganadoCentavos(e: EntradaGanado, tasaBs: number | null): number | null {
  const divisas = brutoCentavos(e.diasTrabajados, e.montoBaseUsd) + aCentavos(e.bonificacionUsd);
  const bs = brutoCentavos(e.diasTrabajados, e.montoBaseBs);
  if (bs === 0) return divisas;
  return tasaBs === null ? null : divisas + usdCentavos(bs, tasaBs);
}

/** Lo ganado del renglón (USD) = bruto de divisas + bonificación + bruto Bs / tasa; null si hay Bs y falta la tasa. */
export function gananciaDeLinea(e: EntradaGanado, tasaBs: number | null): number | null {
  const c = ganadoCentavos(e, tasaBs);
  return c === null ? null : deCentavos(c);
}

/**
 * True si el descuento de préstamo supera lo ganado del renglón. Con sueldo en Bs y sin tasa no se puede saber: da false
 * (el servidor exige la tasa y vuelve a evaluarlo).
 */
export function prestamoExcedeGanado(e: EntradaGanado & Pick<EntradaLinea, 'descuentoPrestamoUsd'>, tasaBs: number | null): boolean {
  const ganado = ganadoCentavos(e, tasaBs);
  return ganado !== null && aCentavos(e.descuentoPrestamoUsd) > ganado;
}

function monedaDeLinea(pagarUsd: number, pagarBs: number | null): MonedaLinea {
  const hayBs = pagarBs === null || pagarBs !== 0;
  if (hayBs && pagarUsd !== 0) return 'MIXTO';
  return hayBs ? 'BS' : 'USD';
}

export function calcularLinea(e: EntradaLinea, tasaBs: number | null): LineaCalculada {
  const brutoDiv = brutoCentavos(e.diasTrabajados, e.montoBaseUsd);
  const brutoBs = brutoCentavos(e.diasTrabajados, e.montoBaseBs);
  const ganadoDiv = brutoDiv + aCentavos(e.bonificacionUsd);
  const descuentos = aCentavos(e.descuentoTrabajoUsd) + aCentavos(e.descuentoPrestamoUsd);
  // Con parte en Bs, lo que las divisas no cubren se descuenta de los Bs; sin ella, todo va a divisas (puede quedar negativo).
  const contraDivisas = brutoBs > 0 ? Math.min(descuentos, ganadoDiv) : descuentos;
  const sobrante = descuentos - contraDivisas;
  const pagarUsd = ganadoDiv - contraDivisas;
  const faltaTasa = tasaBs === null && brutoBs > 0;
  const pagarBs = tasaBs === null ? (faltaTasa ? null : 0) : brutoBs - bsCentavos(sobrante, tasaBs);
  const equivalente = pagarBs === null ? null : tasaBs === null ? 0 : usdCentavos(pagarBs, tasaBs);
  const total = pagarUsd + (equivalente ?? 0);
  const brutoTotal = brutoDiv + (tasaBs !== null && brutoBs > 0 ? usdCentavos(brutoBs, tasaBs) : 0);
  return {
    totalBrutoUsd: deCentavos(brutoTotal),
    brutoBs: deCentavos(brutoBs),
    montoRefBs: tasaBs === null ? null : deCentavos(bsCentavos(brutoDiv, tasaBs) + brutoBs),
    bonificacionUsd: e.bonificacionUsd,
    descuentoTrabajoUsd: e.descuentoTrabajoUsd,
    descuentoPrestamoUsd: e.descuentoPrestamoUsd,
    descuentosUsd: deCentavos(descuentos),
    pagarUsd: deCentavos(pagarUsd),
    pagarBs: pagarBs === null ? null : deCentavos(pagarBs),
    equivalenteBsUsd: equivalente === null ? null : deCentavos(equivalente),
    totalUsd: deCentavos(total),
    totalBs: tasaBs === null ? null : deCentavos(bsCentavos(total, tasaBs)),
    monedaPago: monedaDeLinea(deCentavos(pagarUsd), pagarBs === null ? null : deCentavos(pagarBs)),
    negativo: pagarUsd < 0 || (pagarBs !== null && pagarBs < 0),
    prestamoExcedeGanado: prestamoExcedeGanado(e, tasaBs),
    faltaTasa,
  };
}

/** Posiciones de los renglones con total negativo (hay que avisar y pedir confirmación explícita). */
export function lineasNegativas(lineas: ReadonlyArray<{ negativo: boolean }>): number[] {
  return lineas.flatMap((l, i) => (l.negativo ? [i] : []));
}

export function calcularTotales(lineas: readonly LineaParaTotales[], tasaBs: number | null): TotalesNomina {
  const divisasC = lineas.reduce((a, l) => a + aCentavos(l.pagarUsd), 0);
  const bsSinTasa = lineas.some(l => l.pagarBs === null);
  const totalBsC = lineas.reduce((a, l) => a + aCentavos(l.pagarBs ?? 0), 0);
  const equivalenteC = lineas.reduce((a, l) => a + aCentavos(l.equivalenteBsUsd ?? 0), 0);
  const divisasEnBsC = tasaBs === null ? null : bsCentavos(divisasC, tasaBs);
  const combinadoBsC = bsSinTasa || (divisasEnBsC === null && divisasC !== 0) ? null : totalBsC + (divisasEnBsC ?? 0);
  return {
    cantidad: lineas.length,
    cantidadDivisas: lineas.filter(l => aCentavos(l.pagarUsd) > 0).length,
    cantidadBs: lineas.filter(l => l.pagarBs === null || aCentavos(l.pagarBs) > 0).length,
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
