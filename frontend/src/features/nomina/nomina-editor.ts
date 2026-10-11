/**
 * Lógica pura del editor de la nómina semanal (sin React). Los renglones guardan los campos como TEXTO (lo que se
 * escribe en pantalla); aquí se convierten a números y se calculan con las fórmulas compartidas.
 * La vista previa es solo informativa: el servidor recalcula todo al guardar.
 */
import {
  calcularLinea, calcularTotales, domingoDe, lunesDe, prestamoExcedeGanado, type LineaCalculada, type MonedaPago, type TotalesNomina,
} from '../../../../shared/types/nomina-calculo.js';
import type { CandidatoNomina, LineaNomina, TipoTrabajador } from '../../../../shared/types/nomina.js';

export const DIAS_MAX = 7;
const DIA_MS = 24 * 60 * 60 * 1000;

export interface CuotaEditor {
  prestamoId: string;
  numero: number;
  /** Saldo vigente del préstamo (tope de la cuota). */
  saldoUsd: number;
  monto: string;
}

export interface RenglonEditor {
  trabajadorId: string;
  nombre: string;
  monedaPago: MonedaPago;
  dias: string;
  montoBase: string;
  bonificacion: string;
  descuentoTrabajo: string;
  cuotas: CuotaEditor[];
  nota: string;
}

export interface RenglonCalculado extends RenglonEditor {
  calculo: LineaCalculada;
}

/** Número desde un texto con coma o punto decimal; null si está vacío o no es un número. */
export function leerNumero(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.');
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

const numeroOCero = (texto: string): number => leerNumero(texto) ?? 0;
const aTexto = (n: number): string => String(n);

export function renglonDeCandidato(c: CandidatoNomina): RenglonEditor {
  return {
    trabajadorId: c.trabajadorId,
    nombre: c.nombre,
    monedaPago: c.monedaPagoSugerida,
    dias: '',
    montoBase: aTexto(c.pagoDiarioUsd),
    bonificacion: '',
    descuentoTrabajo: '',
    // Todos los préstamos con saldo quedan a la vista; solo se propone descontar los que tienen cuota semanal.
    cuotas: c.prestamos.map(p => ({
      prestamoId: p.id, numero: p.numero, saldoUsd: p.saldoUsd, monto: p.cuotaSugeridaUsd > 0 ? aTexto(p.cuotaSugeridaUsd) : '',
    })),
    nota: '',
  };
}

function cuotasDeLinea(l: LineaNomina, prestamos: CandidatoNomina['prestamos']): CuotaEditor[] {
  const guardadas = l.cuotas.map(c => ({
    prestamoId: c.prestamoId,
    numero: c.prestamoNumero,
    saldoUsd: prestamos.find(p => p.id === c.prestamoId)?.saldoUsd ?? c.montoUsd,
    monto: aTexto(c.montoUsd),
  }));
  const otras = prestamos
    .filter(p => !l.cuotas.some(c => c.prestamoId === p.id))
    .map(p => ({ prestamoId: p.id, numero: p.numero, saldoUsd: p.saldoUsd, monto: '' }));
  return [...guardadas, ...otras];
}

/** Reconstruye un renglón guardado; el saldo del préstamo es el vigente (el guardado aún no descuenta nada hasta cerrar). */
export function renglonDeLinea(l: LineaNomina, candidatos: readonly CandidatoNomina[]): RenglonEditor {
  const prestamos = candidatos.find(c => c.trabajadorId === l.trabajadorId)?.prestamos ?? [];
  return {
    trabajadorId: l.trabajadorId,
    nombre: l.trabajadorNombre,
    monedaPago: l.monedaPago,
    dias: aTexto(l.diasTrabajados),
    montoBase: aTexto(l.montoBaseUsd),
    bonificacion: l.bonificacionUsd > 0 ? aTexto(l.bonificacionUsd) : '',
    descuentoTrabajo: l.descuentoTrabajoUsd > 0 ? aTexto(l.descuentoTrabajoUsd) : '',
    cuotas: cuotasDeLinea(l, prestamos),
    nota: l.nota ?? '',
  };
}

export function renglonesConTotales(renglones: readonly RenglonEditor[], tasa: number | null): RenglonCalculado[] {
  return renglones.map(r => ({
    ...r,
    calculo: calcularLinea({
      diasTrabajados: numeroOCero(r.dias),
      montoBaseUsd: numeroOCero(r.montoBase),
      bonificacionUsd: numeroOCero(r.bonificacion),
      descuentoTrabajoUsd: numeroOCero(r.descuentoTrabajo),
      descuentoPrestamoUsd: r.cuotas.reduce((a, c) => a + numeroOCero(c.monto), 0),
      monedaPago: r.monedaPago,
    }, tasa),
  }));
}

export function totalesDeRenglones(renglones: readonly RenglonCalculado[], tasa: number | null): TotalesNomina {
  return calcularTotales(renglones.map(r => ({ monedaPago: r.monedaPago, totalUsd: r.calculo.totalUsd, totalBs: r.calculo.totalBs })), tasa);
}

/** Primer problema que impide guardar (mensaje en español) o null. */
export function validarRenglones(renglones: readonly RenglonEditor[]): string | null {
  if (renglones.length === 0) return 'Agrega al menos un trabajador a la nómina.';
  for (const r of renglones) {
    const dias = leerNumero(r.dias);
    if (dias === null || dias < 0 || dias > DIAS_MAX) return `${r.nombre}: los días trabajados deben estar entre 0 y ${DIAS_MAX}.`;
    if (leerNumero(r.montoBase) === null) return `${r.nombre}: falta el monto base en divisas.`;
    for (const c of r.cuotas) {
      if (numeroOCero(c.monto) > c.saldoUsd) {
        return `${r.nombre}: la cuota del préstamo PRE-${String(c.numero).padStart(4, '0')} supera su saldo (USD ${c.saldoUsd}).`;
      }
    }
    if (prestamoExcedeGanado({
      diasTrabajados: dias, montoBaseUsd: numeroOCero(r.montoBase), bonificacionUsd: numeroOCero(r.bonificacion),
      descuentoPrestamoUsd: r.cuotas.reduce((a, c) => a + numeroOCero(c.monto), 0),
    })) {
      return `${r.nombre}: las cuotas de préstamo superan lo que ganó en la semana (días x monto base + bonificación). Baja la cuota.`;
    }
  }
  return null;
}

export interface EstadoParaGuardar {
  tipo: TipoTrabajador;
  semana: string;
  tasa: string;
  version: number | null;
  confirmarNegativos: boolean;
  renglones: readonly RenglonEditor[];
}

export interface PayloadNomina {
  tipo: TipoTrabajador;
  semanaInicio: string;
  tasaBs: number | null;
  version: number | null;
  confirmarNegativos: boolean;
  lineas: Array<{
    trabajadorId: string;
    monedaPago: MonedaPago;
    diasTrabajados: number;
    montoBaseUsd: number;
    bonificacionUsd: number;
    descuentoTrabajoUsd: number;
    cuotas: Array<{ prestamoId: string; montoUsd: number }>;
    nota: string | null;
  }>;
}

/** Cuerpo para el servidor: solo lo que se escribió (los totales los recalcula el servidor). */
export function construirPayload(e: EstadoParaGuardar): PayloadNomina {
  return {
    tipo: e.tipo,
    semanaInicio: e.semana,
    tasaBs: leerNumero(e.tasa),
    version: e.version,
    confirmarNegativos: e.confirmarNegativos,
    lineas: e.renglones.map(r => ({
      trabajadorId: r.trabajadorId,
      monedaPago: r.monedaPago,
      diasTrabajados: numeroOCero(r.dias),
      montoBaseUsd: numeroOCero(r.montoBase),
      bonificacionUsd: numeroOCero(r.bonificacion),
      descuentoTrabajoUsd: numeroOCero(r.descuentoTrabajo),
      cuotas: r.cuotas.filter(c => numeroOCero(c.monto) > 0).map(c => ({ prestamoId: c.prestamoId, montoUsd: numeroOCero(c.monto) })),
      nota: r.nota.trim() || null,
    })),
  };
}

/** Lunes de la semana `semanas` semanas después (o antes, si es negativo). */
export function desplazarSemana(lunes: string, semanas: number): string {
  const [a, m, d] = lunes.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d) + semanas * 7 * DIA_MS).toISOString().slice(0, 10);
}

export { domingoDe, lunesDe };
