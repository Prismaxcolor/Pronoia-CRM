/**
 * Arma lo que se guarda de una nómina a partir de lo que manda el navegador. Lógica pura: el servidor recalcula
 * SIEMPRE con nomina-calculo.ts y descarta cualquier total que venga del cliente.
 */
import type { GuardarNominaInput } from '../schemas/nomina.js';
import {
  calcularLinea, calcularTotales, lineasNegativas, sumarCuotas,
  type LineaCalculada, type MonedaPago, type TotalesNomina,
} from './nomina-calculo.js';

export interface LineaArmada extends LineaCalculada {
  trabajadorId: string;
  trabajadorNombre: string;
  monedaPago: MonedaPago;
  diasTrabajados: number;
  montoBaseUsd: number;
  nota: string | null;
  cuotas: Array<{ prestamoId: string; montoUsd: number }>;
}

export interface NominaArmada {
  lineas: LineaArmada[];
  totales: TotalesNomina;
  /** Posiciones de los renglones con total negativo. */
  negativas: number[];
}

/** Lo que recibe la función SQL nomina_guardar: solo ids, nombre y montos (ningún dato personal de la ficha). */
export interface PayloadGuardado {
  tipo: GuardarNominaInput['tipo'];
  semanaInicio: string;
  tasaBs: number | null;
  version: number | null;
  totales: TotalesNomina;
  lineas: LineaArmada[];
}

export function armarNomina(input: GuardarNominaInput, nombres: ReadonlyMap<string, string>): NominaArmada {
  const lineas: LineaArmada[] = input.lineas.map(l => {
    const descuentoPrestamoUsd = sumarCuotas(l.cuotas);
    const calculada = calcularLinea({
      diasTrabajados: l.diasTrabajados,
      montoBaseUsd: l.montoBaseUsd,
      bonificacionUsd: l.bonificacionUsd,
      descuentoTrabajoUsd: l.descuentoTrabajoUsd,
      descuentoPrestamoUsd,
      monedaPago: l.monedaPago,
    }, input.tasaBs);
    return {
      ...calculada,
      trabajadorId: l.trabajadorId,
      trabajadorNombre: nombres.get(l.trabajadorId) ?? '',
      monedaPago: l.monedaPago,
      diasTrabajados: l.diasTrabajados,
      montoBaseUsd: l.montoBaseUsd,
      nota: l.nota,
      cuotas: l.cuotas.map(c => ({ prestamoId: c.prestamoId, montoUsd: c.montoUsd })),
    };
  });
  return { lineas, totales: calcularTotales(lineas, input.tasaBs), negativas: lineasNegativas(lineas) };
}

export function payloadGuardado(input: GuardarNominaInput, armada: NominaArmada): PayloadGuardado {
  return {
    tipo: input.tipo,
    semanaInicio: input.semanaInicio,
    tasaBs: input.tasaBs,
    version: input.version,
    totales: armada.totales,
    lineas: armada.lineas,
  };
}

/** Moneda de pago propuesta para un trabajador (editable en la nómina): con Binance se paga en divisas; si no, en Bs. */
export function monedaPagoSugerida(t: { binanceCorreoId: string | null; pagoMovilTelefono: string | null }): MonedaPago {
  return t.binanceCorreoId ? 'USD' : 'BS';
}

export function nombreCompleto(t: { nombres: string; apellidos: string }): string {
  return `${t.nombres} ${t.apellidos}`.trim();
}

export function mensajeNegativos(cantidad: number): string {
  const quien = cantidad === 1 ? '1 trabajador tiene' : `${cantidad} trabajadores tienen`;
  return `${quien} un total a pagar negativo (los descuentos superan lo ganado). Revisa los montos; si lo confirmas se guarda solo como borrador, porque una nómina con totales negativos no se puede cerrar.`;
}
