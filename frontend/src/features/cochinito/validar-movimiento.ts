/**
 * Validación pura del formulario de nuevo movimiento (sin React). Devuelve el PRIMER problema encontrado, en el mismo
 * orden en que se le pregunta a la persona, o null si el formulario se puede enviar.
 */
import type { PlanComisionBancaria } from '../../../../shared/types/comision-bancaria.js';
import { formatearNumero } from '../../lib/formato';
import { planDeFormulario, type FormularioMesa } from './transferencia-mesa';

export type TipoMovimientoFormulario = 'ingreso' | 'egreso' | 'transferencia';

/** `campo` indica dónde se muestra el mensaje: el aviso general del formulario o bajo el selector de categoría. */
export interface ErrorFormulario {
  campo: 'general' | 'categoria';
  mensaje: string;
}

export interface EntradaValidacion {
  tipo: TipoMovimientoFormulario | '';
  /** Cuenta de origen elegida (undefined = ninguna). */
  banca: { moneda: string; saldo: number } | undefined;
  monto: number;
  /** Mensaje si la comisión bancaria aún no se pudo verificar (ver bloqueoPorComision); null si no bloquea. */
  bloqueoComision: string | null;
  planComision: PlanComisionBancaria;
  /** Mensaje de la categoría pendiente de elegir; null si no se pide categoría o ya se eligió. */
  categoriaFalta: string | null;
  /** Solo transferencia: cuenta destino elegida. */
  destino: { moneda: string } | undefined;
  monedasDistintas: boolean;
  montoDestino: number;
  mesa: { activa: boolean; form: FormularioMesa };
}

const MENSAJE_DECIMALES = 'El monto admite como máximo 2 decimales (centavos).';
const TOLERANCIA = 1e-6;

const general = (mensaje: string): ErrorFormulario => ({ campo: 'general', mensaje });

/** True si el número no tiene más de 2 decimales (tolera el error de coma flotante). */
export function tieneMaximoDosDecimales(n: number): boolean {
  const centavos = n * 100;
  return Number.isFinite(n) && Math.abs(centavos - Math.round(centavos)) < TOLERANCIA * Math.max(1, Math.abs(centavos));
}

function validarOrigen(e: EntradaValidacion): ErrorFormulario | null {
  if (!e.tipo) return general('Selecciona el tipo de movimiento: ingreso, egreso o transferencia.');
  if (!e.banca) return general('Selecciona la cuenta o caja del movimiento.');
  if (!e.monto || e.monto <= 0) return general('El monto debe ser mayor a 0.');
  if (!tieneMaximoDosDecimales(e.monto)) return general(MENSAJE_DECIMALES);
  if (e.tipo !== 'ingreso' && e.monto > e.banca.saldo) {
    return general(`Saldo insuficiente. Disponible: ${e.banca.moneda === 'USD' ? '$' : 'Bs '}${formatearNumero(e.banca.saldo, 2)}`);
  }
  return null;
}

function validarTransferencia(e: EntradaValidacion, banca: { moneda: string; saldo: number }): ErrorFormulario | null {
  if (!e.destino) return general('Selecciona la banca destino.');
  if (e.monedasDistintas && e.montoDestino <= 0) return general('Ingresa el monto que llega a la banca destino.');
  if (e.monedasDistintas && !tieneMaximoDosDecimales(e.montoDestino)) return general(MENSAJE_DECIMALES);
  if (!e.mesa.activa) return null;
  if (!e.mesa.form.cambistaId) return general('Elige el cambista de la mesa de cambio.');
  const plan = planDeFormulario(e.mesa.form, {
    monedaOrigen: banca.moneda, monedaDestino: e.destino.moneda, monto: e.monto,
    montoDestino: e.monedasDistintas ? e.montoDestino : null, saldoOrigen: banca.saldo,
  });
  return plan.ok ? null : general(plan.error);
}

export function validarMovimiento(e: EntradaValidacion): ErrorFormulario | null {
  const origen = validarOrigen(e);
  if (origen) return origen;
  if (e.bloqueoComision) return general(e.bloqueoComision);
  if (!e.planComision.ok) return general(e.planComision.error);
  if (e.categoriaFalta) return { campo: 'categoria', mensaje: e.categoriaFalta };
  if (e.tipo === 'transferencia' && e.banca) return validarTransferencia(e, e.banca);
  return null;
}
