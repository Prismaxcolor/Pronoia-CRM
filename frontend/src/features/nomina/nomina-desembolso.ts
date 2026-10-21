/**
 * Lógica pura del pago (desembolso) de un préstamo o adelanto desde el Wallet, sin React. El servidor decide todo y vuelve a
 * validar (cuenta, saldo, comisión, monto); aquí se valida lo evidente antes de enviar y se calcula la vista previa.
 *
 * El préstamo es en USD. Desde una cuenta USD sale ese monto; desde una cuenta en Bs sale monto x tasa (Bs por USD), con la
 * tasa que escribe quien paga.
 */
import type { Banca } from '../../../../shared/types/banca.js';
import { bancasEditables } from '../usuarios/acceso-bancas';
import { leerNumero } from './nomina-editor';
import { llevaDeOpcion, ofrecerComision, planDeComision, type OpcionComision } from '../cochinito/comision-formulario';

/** Lo que el usuario llena en el formulario del pago del préstamo. */
export interface EstadoDesembolso {
  bancaId: string;
  fecha: string;
  referencia: string;
  /** Texto de la tasa (Bs por USD); solo se usa con cuentas en Bs. */
  tasa: string;
  comision: OpcionComision;
}

/** Cuerpo del pago (en POST /prestamos como `desembolso` y en POST /prestamos/:id/pagar). */
export interface PayloadDesembolso {
  bancaId: string;
  fecha: string;
  referencia: string | null;
  tasaBs: number | null;
  llevaComision?: boolean;
  /** URLs ya subidas con subirComprobantePago (puede ir vacío). */
  comprobantes: string[];
}

export const desembolsoVacio = (fecha: string): EstadoDesembolso => ({ bancaId: '', fecha, referencia: '', tasa: '', comision: '' });

/** Cuentas desde las que se puede pagar un préstamo: vigentes, editables por la persona y en USD o Bs. */
export function cuentasDeDesembolso(bancas: readonly Banca[]): Banca[] {
  return bancasEditables(bancas).filter(b => !b.archivada && (b.moneda === 'USD' || b.moneda === 'VES'));
}

const esBs = (banca: Pick<Banca, 'moneda'> | undefined): boolean => banca?.moneda === 'VES';

/** Monto que sale de la cuenta en su moneda; null si es una cuenta en Bs y falta una tasa válida. */
export function montoDeDesembolso(montoUsd: number, banca: Pick<Banca, 'moneda'> | undefined, tasa: string): number | null {
  if (!esBs(banca)) return montoUsd;
  const t = leerNumero(tasa);
  return t === null || !(t > 0) ? null : Math.round(montoUsd * 100 * t) / 100;
}

/** ¿Se pregunta por la comisión bancaria? Solo egresos desde una cuenta en Bs, con la migración aplicada. */
export function preguntaComisionDesembolso(banca: Pick<Banca, 'moneda'> | undefined, comisionDisponible: boolean): boolean {
  return banca !== undefined && ofrecerComision({ disponible: comisionDisponible, tipo: 'egreso', moneda: banca.moneda, mesaActiva: false });
}

/** Primer problema que impide enviar el pago del préstamo; null si todo está listo. */
export function validarDesembolso(
  e: EstadoDesembolso, montoUsd: number, bancas: readonly Banca[], comisionDisponible: boolean,
): string | null {
  const banca = bancas.find(b => b.id === e.bancaId);
  if (!banca) return 'Elige la cuenta desde la que se paga el préstamo.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.fecha)) return 'Indica la fecha del pago.';
  const monto = montoDeDesembolso(montoUsd, banca, e.tasa);
  if (monto === null) return 'Indica la tasa (Bs por USD) para pagar desde una cuenta en bolívares.';
  const plan = planDeComision({
    ofrecida: preguntaComisionDesembolso(banca, comisionDisponible), tipo: 'egreso', moneda: banca.moneda, monto, opcion: e.comision, saldo: banca.saldo,
  });
  if (!plan.ok) return plan.error;
  if (plan.totalDebitado > banca.saldo) return `Saldo insuficiente en ${banca.nombre}.`;
  return null;
}

/** Cuerpo para el servidor. La tasa solo viaja con cuentas en Bs y la comisión solo donde se preguntó. */
export function construirDesembolso(
  e: EstadoDesembolso, bancas: readonly Banca[], comisionDisponible: boolean, comprobantes: string[],
): PayloadDesembolso {
  const banca = bancas.find(b => b.id === e.bancaId);
  const lleva = preguntaComisionDesembolso(banca, comisionDisponible) ? llevaDeOpcion(e.comision) : null;
  return {
    bancaId: e.bancaId,
    fecha: e.fecha,
    referencia: e.referencia.trim() === '' ? null : e.referencia.trim(),
    tasaBs: esBs(banca) ? leerNumero(e.tasa) : null,
    ...(lleva === null ? {} : { llevaComision: lleva }),
    comprobantes,
  };
}
