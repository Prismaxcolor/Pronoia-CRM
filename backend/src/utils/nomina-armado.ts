/**
 * Arma lo que se guarda de una nómina a partir de lo que manda el navegador. Lógica pura: el servidor recalcula
 * SIEMPRE con nomina-calculo.ts y descarta cualquier total que venga del cliente.
 */
import type { GuardarNominaInput } from '../schemas/nomina.js';
import {
  calcularLinea, calcularTotales, lineasNegativas, sumarCuotas,
  type LineaCalculada, type TotalesNomina,
} from './nomina-calculo.js';

export interface LineaArmada extends LineaCalculada {
  trabajadorId: string;
  trabajadorNombre: string;
  diasTrabajados: number;
  montoBaseUsd: number;
  montoBaseBs: number;
  nota: string | null;
  cuotas: Array<{ prestamoId: string; montoUsd: number }>;
}

export interface NominaArmada {
  lineas: LineaArmada[];
  totales: TotalesNomina;
  /** Posiciones de los renglones con total negativo. */
  negativas: number[];
  /** Hay renglones con sueldo en Bs y la nómina no tiene tasa: no se puede guardar. */
  faltaTasa: boolean;
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
      montoBaseBs: l.montoBaseBs,
      bonificacionUsd: l.bonificacionUsd,
      bonificacionBsUsd: l.bonificacionBsUsd,
      descuentoTrabajoUsd: l.descuentoTrabajoUsd,
      descuentoPrestamoUsd,
    }, input.tasaBs);
    return {
      ...calculada,
      trabajadorId: l.trabajadorId,
      trabajadorNombre: nombres.get(l.trabajadorId) ?? '',
      diasTrabajados: l.diasTrabajados,
      montoBaseUsd: l.montoBaseUsd,
      montoBaseBs: l.montoBaseBs,
      nota: l.nota,
      cuotas: l.cuotas.map(c => ({ prestamoId: c.prestamoId, montoUsd: c.montoUsd })),
    };
  });
  return {
    lineas,
    totales: calcularTotales(lineas, input.tasaBs),
    negativas: lineasNegativas(lineas),
    faltaTasa: lineas.some(l => l.faltaTasa),
  };
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

export function nombreCompleto(t: { nombres: string; apellidos: string }): string {
  return `${t.nombres} ${t.apellidos}`.trim();
}

export function mensajeNegativos(cantidad: number): string {
  const quien = cantidad === 1 ? '1 trabajador tiene' : `${cantidad} trabajadores tienen`;
  return `${quien} un total a pagar negativo (los descuentos superan lo ganado). Revisa los montos; si lo confirmas se guarda solo como borrador, porque una nómina con totales negativos no se puede cerrar.`;
}

export const MENSAJE_FALTA_TASA =
  'Indica la tasa de la nómina: hay trabajadores con sueldo en bolívares y sin ella no se puede calcular lo que se les paga en Bs.';
