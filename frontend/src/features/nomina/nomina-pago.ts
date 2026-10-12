/**
 * Lógica pura de "Pagar desde Wallet" (fase 2 de la nómina), sin React. El servidor decide los montos, la categoría y
 * vuelve a validar todo; aquí solo se arma la elección de cuentas, se valida lo evidente antes de enviar y se redactan
 * los textos del estado del pago.
 */
import type { Banca } from '../../../../shared/types/banca.js';
import type { MonedaPago, TotalesNomina } from '../../../../shared/types/nomina-calculo.js';
import type { Nomina, PagoNomina } from '../../../../shared/types/nomina.js';
import { formatearFecha, formatearNumero } from '../../lib/formato';
import { bancasEditables } from '../usuarios/acceso-bancas';
import {
  bloqueoPorComision, llevaDeOpcion, ofrecerComision, planDeComision, type EstadoComision, type OpcionComision,
} from '../cochinito/comision-formulario';

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

/** Elección de la persona para un grupo: cuenta y, en cuentas Bs, si lleva comisión bancaria. */
export interface EleccionPago {
  bancaId: string;
  comision: OpcionComision;
}

export type Elecciones = Readonly<Partial<Record<MonedaPago, EleccionPago>>>;

export const ELECCION_VACIA: EleccionPago = { bancaId: '', comision: '' };

export interface PayloadPago {
  fecha: string;
  referencia: string | null;
  bancas: Array<{ moneda: MonedaPago; bancaId: string; llevaComision?: boolean }>;
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

function problemaDeGrupo(grupo: GrupoPago, eleccion: EleccionPago | undefined, bancas: readonly Banca[], comisionDisponible: boolean): string | null {
  const banca = eleccion ? bancas.find(b => b.id === eleccion.bancaId) : undefined;
  if (!eleccion || !banca) return `Elige la cuenta del pago en ${ETIQUETA_GRUPO[grupo.moneda].toLowerCase()}.`;
  const plan = planDeComision({
    ofrecida: preguntaComision(banca, comisionDisponible), tipo: 'egreso', moneda: banca.moneda, monto: grupo.monto,
    opcion: eleccion.comision, saldo: banca.saldo,
  });
  if (!plan.ok) return plan.error;
  if (plan.totalDebitado > banca.saldo) return `Saldo insuficiente en ${banca.nombre}.`;
  return null;
}

/** Primer problema que impide enviar (cuenta sin elegir, comisión sin responder, saldo insuficiente); null si todo está listo. */
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

/** Cuerpo del POST /nominas/:id/pagar. La comisión solo viaja en cuentas Bs donde se preguntó. */
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
    bancas: grupos.map(g => {
      const eleccion = elecciones[g.moneda] ?? ELECCION_VACIA;
      const banca = bancas.find(b => b.id === eleccion.bancaId);
      const lleva = preguntaComision(banca, comisionDisponible) ? llevaDeOpcion(eleccion.comision) : null;
      return { moneda: g.moneda, bancaId: eleccion.bancaId, ...(lleva === null ? {} : { llevaComision: lleva }) };
    }),
  };
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
  return `${formatearMontoPago(p.monedaPago, p.monto)} desde ${p.bancaNombre || 'la cuenta elegida'}${mv} · ${formatearFecha(p.fecha)}`;
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
    const banca = bancas.find(b => b.id === elecciones[grupo.moneda]?.bancaId);
    const bloqueo = banca ? bloqueoPorComision({ estado, tipo: 'egreso', moneda: banca.moneda, mesaActiva: false }) : null;
    if (bloqueo) return bloqueo;
  }
  return null;
}
