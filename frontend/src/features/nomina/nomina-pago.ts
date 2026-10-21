/**
 * Lógica pura de "Pagar desde Wallet" (fase 2 de la nómina), sin React. El servidor decide los montos, la categoría y
 * vuelve a validar todo; aquí solo se arma la elección de cuentas, se valida lo evidente antes de enviar y se redactan
 * los textos del estado del pago.
 */
import type { Banca } from '../../../../shared/types/banca.js';
import type { MonedaPago, TotalesNomina } from '../../../../shared/types/nomina-calculo.js';
import type { LineaNomina, Nomina, PagoNomina } from '../../../../shared/types/nomina.js';
import { formatearFecha, formatearNumero } from '../../lib/formato';
import { bancasEditables } from '../usuarios/acceso-bancas';
import { textoEquivalenteUsd } from './nomina-cargo';
import {
  bloqueoPorComision, llevaDeOpcion, ofrecerComision, planDeComision, type EstadoComision,
} from '../cochinito/comision-formulario';
import {
  ELECCION_VACIA, MAX_CUENTAS_POR_MONEDA, centavosDe, esReparto, filasDe, montoDeFila, resumenReparto, textoDiferencia,
  type EleccionPago,
} from './nomina-reparto';

export { ELECCION_VACIA, type EleccionPago };

/** Moneda de la cuenta del Wallet que corresponde a cada moneda de pago de la nómina. */
export const MONEDA_CUENTA: Record<MonedaPago, string> = { USD: 'USD', BS: 'VES' };

export const ETIQUETA_GRUPO: Record<MonedaPago, string> = { USD: 'Divisas (USD)', BS: 'Bolívares (Bs)' };

/** Lo que se paga en una moneda: monto en esa moneda, su equivalente en USD y a cuántos trabajadores. */
export interface GrupoPago {
  moneda: MonedaPago;
  monto: number;
  montoUsd: number;
  cantidad: number;
}

/**
 * Elección de la persona por moneda: una o varias cuentas (reparto). Cada cuenta lleva su monto cuando hay más de una y, en
 * cuentas Bs, su propia comisión bancaria Sí/No.
 */
export type Elecciones = Readonly<Partial<Record<MonedaPago, readonly EleccionPago[]>>>;

export interface PayloadPago {
  fecha: string;
  referencia: string | null;
  /** Una entrada por cuenta; `monto` solo viaja cuando la moneda se reparte entre varias cuentas. */
  bancas: Array<{ moneda: MonedaPago; bancaId: string; llevaComision?: boolean; monto?: number }>;
}

/** Grupos con algo que pagar, a partir de los totales de la nómina (divisas primero). */
export function gruposDePago(t: TotalesNomina): GrupoPago[] {
  const grupos: GrupoPago[] = [];
  if (t.totalDivisasUsd > 0) grupos.push({ moneda: 'USD', monto: t.totalDivisasUsd, montoUsd: t.totalDivisasUsd, cantidad: t.cantidadDivisas });
  if ((t.totalBs ?? 0) > 0) grupos.push({ moneda: 'BS', monto: t.totalBs ?? 0, montoUsd: t.equivalenteUsdDeBs, cantidad: t.cantidadBs });
  return grupos;
}

/** Cuentas que se ofrecen para un grupo: vigentes, editables por la persona y de la moneda del pago. */
export function cuentasDeGrupo(bancas: readonly Banca[], moneda: MonedaPago): Banca[] {
  return bancasEditables(bancas).filter(b => !b.archivada && b.moneda === MONEDA_CUENTA[moneda]);
}

export function formatearMontoPago(moneda: MonedaPago, monto: number): string {
  return `${moneda === 'USD' ? 'USD' : 'Bs'} ${formatearNumero(monto, 2)}`;
}

/** ¿Se pregunta por la comisión bancaria en este grupo? Solo egresos desde una cuenta en Bs, con la migración aplicada. */
export function preguntaComision(banca: Pick<Banca, 'moneda'> | undefined, comisionDisponible: boolean): boolean {
  return banca !== undefined && ofrecerComision({ disponible: comisionDisponible, tipo: 'egreso', moneda: banca.moneda, mesaActiva: false });
}

function problemaDeFila(
  fila: EleccionPago, centavos: number, bancas: readonly Banca[], comisionDisponible: boolean, moneda: MonedaPago,
): string | null {
  const banca = bancas.find(b => b.id === fila.bancaId);
  if (!banca) return `Elige la cuenta del pago en ${ETIQUETA_GRUPO[moneda].toLowerCase()}.`;
  const plan = planDeComision({
    ofrecida: preguntaComision(banca, comisionDisponible), tipo: 'egreso', moneda: banca.moneda, monto: centavos / 100,
    opcion: fila.comision, saldo: banca.saldo,
  });
  if (!plan.ok) return plan.error;
  if (plan.totalDebitado > banca.saldo) return `Saldo insuficiente en ${banca.nombre}.`;
  return null;
}

/** Montos del reparto: cada cuenta con un monto válido mayor a cero y la suma exacta de lo que se debe. */
function problemaDeMontos(grupo: GrupoPago, filas: readonly EleccionPago[]): string | null {
  if (!esReparto(filas)) return null;
  const total = centavosDe(grupo.monto);
  for (const [i] of filas.entries()) {
    const c = montoDeFila(filas, i, total);
    if (c === null || c <= 0) return `Indica un monto mayor a cero para la cuenta ${i + 1} (${ETIQUETA_GRUPO[grupo.moneda]}).`;
  }
  const diferencia = textoDiferencia(grupo.moneda, resumenReparto(filas, total));
  return diferencia ? `${ETIQUETA_GRUPO[grupo.moneda]}: ${diferencia.charAt(0).toLowerCase()}${diferencia.slice(1)}.` : null;
}

function problemaDeGrupo(
  grupo: GrupoPago, elegidas: readonly EleccionPago[] | undefined, bancas: readonly Banca[], comisionDisponible: boolean,
): string | null {
  const filas = filasDe(elegidas);
  if (filas.length > MAX_CUENTAS_POR_MONEDA) return `Máximo ${MAX_CUENTAS_POR_MONEDA} cuentas por moneda.`;
  const total = centavosDe(grupo.monto);
  for (const [i, fila] of filas.entries()) {
    const problema = problemaDeFila(fila, montoDeFila(filas, i, total) ?? 0, bancas, comisionDisponible, grupo.moneda);
    if (problema) return problema;
  }
  if (new Set(filas.map(f => f.bancaId)).size !== filas.length) return 'La misma cuenta no puede repetirse dentro del reparto.';
  return problemaDeMontos(grupo, filas);
}

/** Primer problema que impide enviar (cuenta sin elegir, monto que no cuadra, comisión sin responder, saldo insuficiente); null si todo está listo. */
export function validarPago(
  grupos: readonly GrupoPago[],
  elecciones: Elecciones,
  bancas: readonly Banca[],
  comisionDisponible: boolean,
  fecha: string,
): string | null {
  if (grupos.length === 0) return 'La nómina no tiene montos por pagar.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return 'Indica la fecha del pago.';
  for (const grupo of grupos) {
    const problema = problemaDeGrupo(grupo, elecciones[grupo.moneda], bancas, comisionDisponible);
    if (problema) return problema;
  }
  return null;
}

/**
 * Cuerpo del POST /nominas/:id/pagar. La comisión solo viaja en cuentas Bs donde se preguntó; el monto solo en un reparto
 * (con una cuenta el servidor calcula el total).
 */
export function construirPayloadPago(
  grupos: readonly GrupoPago[],
  elecciones: Elecciones,
  bancas: readonly Banca[],
  comisionDisponible: boolean,
  fecha: string,
  referencia: string,
): PayloadPago {
  return {
    fecha,
    referencia: referencia.trim() === '' ? null : referencia.trim(),
    bancas: grupos.flatMap(g => {
      const filas = filasDe(elecciones[g.moneda]);
      return filas.map((fila, i) => {
        const banca = bancas.find(b => b.id === fila.bancaId);
        const lleva = preguntaComision(banca, comisionDisponible) ? llevaDeOpcion(fila.comision) : null;
        const centavos = montoDeFila(filas, i, centavosDe(g.monto));
        return {
          moneda: g.moneda, bancaId: fila.bancaId,
          ...(esReparto(filas) && centavos !== null ? { monto: centavos / 100 } : {}),
          ...(lleva === null ? {} : { llevaComision: lleva }),
        };
      });
    }),
  };
}

/** Una línea por cuenta con lo que sale de ella ("• USD 20,00 de CAJA BINANCE PS"), para la confirmación final. */
export function resumenDebitos(grupos: readonly GrupoPago[], elecciones: Elecciones, bancas: readonly Banca[]): string {
  return grupos.flatMap(g => {
    const filas = filasDe(elecciones[g.moneda]);
    return filas.map((fila, i) => {
      const banca = bancas.find(b => b.id === fila.bancaId);
      const centavos = montoDeFila(filas, i, centavosDe(g.monto)) ?? 0;
      return `• ${formatearMontoPago(g.moneda, centavos / 100)} de ${banca?.nombre ?? 'la cuenta elegida'}`;
    });
  }).join('\n');
}

/** Cuerpo del POST /nominas/:id/trabajadores/:trabajadorId/pagar: lo mismo que el pago de la nómina más los comprobantes. */
export interface PayloadPagoTrabajador extends PayloadPago {
  /** URLs ya subidas con subirComprobantePago (puede ir vacío). */
  comprobantes: string[];
}

export type EstadoPagoNomina = 'sin-pagar' | 'pagada' | 'pago-anulado';

export function estadoPagoNomina(pagos: readonly PagoNomina[]): EstadoPagoNomina {
  if (pagos.length === 0) return 'sin-pagar';
  return pagos.every(p => p.anulado) ? 'pago-anulado' : 'pagada';
}

/** ¿Se ofrece el botón "Pagar desde Wallet"? Nómina cerrada, sin pago y con algo que pagar. */
export function sePuedePagar(nomina: Pick<Nomina, 'estado' | 'pagos' | 'totales'>): boolean {
  return nomina.estado === 'CERRADA' && nomina.pagos.length === 0 && gruposDePago(nomina.totales).length > 0;
}

/** Una línea por pago: "USD 100,00 desde CAJA CHICA · MV-0012 · 09/10/2026". Sin datos personales. */
export function lineaDePago(p: PagoNomina): string {
  const mv = p.movimientoNumero === null ? '' : ` · MV-${String(p.movimientoNumero).padStart(4, '0')}`;
  const eq = p.monedaPago === 'BS' ? textoEquivalenteUsd(p.equivalenteBinanceUsd) : null;
  const tasa = eq ? ` (${eq} a tasa Binance ${formatearNumero(p.tasaBinance ?? 0, 2)})` : '';
  return `${formatearMontoPago(p.monedaPago, p.monto)}${tasa} desde ${p.bancaNombre || 'la cuenta elegida'}${mv} · ${formatearFecha(p.fecha)}`;
}

/** Texto del estado "Pagada desde X el fecha" (varias cuentas se unen con "y"). */
export function textoPagada(pagos: readonly PagoNomina[]): string {
  const cuentas = [...new Set(pagos.map(p => p.bancaNombre || 'la cuenta elegida'))];
  const fechas = [...new Set(pagos.map(p => formatearFecha(p.fecha)))];
  return `Pagada desde ${cuentas.join(' y ')} el ${fechas.join(' y ')}`;
}

/** Mientras no se sepa si la comisión bancaria aplica (cargando o con error), un pago en Bs no puede enviarse. */
export function bloqueoComisionPago(
  grupos: readonly GrupoPago[],
  elecciones: Elecciones,
  bancas: readonly Banca[],
  estado: EstadoComision,
): string | null {
  for (const grupo of grupos) {
    for (const fila of filasDe(elecciones[grupo.moneda])) {
      const banca = bancas.find(b => b.id === fila.bancaId);
      const bloqueo = banca ? bloqueoPorComision({ estado, tipo: 'egreso', moneda: banca.moneda, mesaActiva: false }) : null;
      if (bloqueo) return bloqueo;
    }
  }
  return null;
}

// --- Pago por trabajador (botón «Pagar» de cada renglón) -------------------------------------------------------------

const centavos = (n: number): number => Math.round(n * 100);

type LineaPagable = Pick<LineaNomina, 'trabajadorId' | 'pagarUsd' | 'pagarBs' | 'totalUsd'>;

/** Lo que se le paga a un trabajador en cada moneda (divisas primero); [] si no tiene nada por cobrar. */
export function gruposDePagoLinea(l: Pick<LineaNomina, 'pagarUsd' | 'pagarBs' | 'totalUsd'>): GrupoPago[] {
  const grupos: GrupoPago[] = [];
  if (l.pagarUsd > 0) grupos.push({ moneda: 'USD', monto: l.pagarUsd, montoUsd: l.pagarUsd, cantidad: 1 });
  if ((l.pagarBs ?? 0) > 0) {
    grupos.push({ moneda: 'BS', monto: l.pagarBs ?? 0, montoUsd: (centavos(l.totalUsd) - centavos(l.pagarUsd)) / 100, cantidad: 1 });
  }
  return grupos;
}

/** Cómo se está pagando la nómina: aún sin pagos, completa (un egreso por moneda) o trabajador por trabajador. */
export type ModoPagoNomina = 'sin-pagos' | 'completa' | 'por-trabajador';

export function modoPagoNomina(pagos: readonly Pick<PagoNomina, 'trabajadorId'>[]): ModoPagoNomina {
  if (pagos.length === 0) return 'sin-pagos';
  return pagos.some(p => p.trabajadorId !== null) ? 'por-trabajador' : 'completa';
}

/** pendiente = sin pagar; pagado = pagos vigentes; anulado = sus pagos se anularon; sin-monto = nada que cobrar. */
export type EstadoPagoTrabajador = 'pendiente' | 'pagado' | 'anulado' | 'sin-monto';

/** Pagos que cubren a un trabajador: los suyos o, si se pagó la nómina completa, los de la nómina. */
export function pagosDeTrabajador(pagos: readonly PagoNomina[], trabajadorId: string): PagoNomina[] {
  return pagos.filter(p => p.trabajadorId === null || p.trabajadorId === trabajadorId);
}

export function estadoPagoTrabajador(nomina: Pick<Nomina, 'pagos'>, linea: LineaPagable): EstadoPagoTrabajador {
  if (gruposDePagoLinea(linea).length === 0) return 'sin-monto';
  const propios = pagosDeTrabajador(nomina.pagos, linea.trabajadorId);
  if (propios.length === 0) return 'pendiente';
  return propios.every(p => p.anulado) ? 'anulado' : 'pagado';
}

/** ¿Se ofrece el botón «Pagar» de este trabajador? Nómina cerrada, sin pago completo y él aún sin pagar. */
export function sePuedePagarTrabajador(nomina: Pick<Nomina, 'estado' | 'pagos'>, linea: LineaPagable): boolean {
  return nomina.estado === 'CERRADA' && modoPagoNomina(nomina.pagos) !== 'completa' && estadoPagoTrabajador(nomina, linea) === 'pendiente';
}

/** Cuántos trabajadores con algo que cobrar ya están pagados, de cuántos. */
export function resumenPagoTrabajadores(nomina: Pick<Nomina, 'pagos' | 'lineas'>): { pagados: number; total: number } {
  const conMonto = nomina.lineas.filter(l => estadoPagoTrabajador(nomina, l) !== 'sin-monto');
  return { pagados: conMonto.filter(l => estadoPagoTrabajador(nomina, l) === 'pagado').length, total: conMonto.length };
}

/** Texto corto del estado de un trabajador para la tabla. */
export const ETIQUETA_ESTADO_PAGO_TRABAJADOR: Record<EstadoPagoTrabajador, string> = {
  pendiente: 'Pendiente', pagado: 'Pagado', anulado: 'Pago anulado', 'sin-monto': 'Sin monto',
};
