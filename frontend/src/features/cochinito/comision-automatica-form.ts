import type { Banca } from '@shared/types/index.js';

/** Mismo tope que el backend y la BD (tasa <= 0.1). */
export const PORCENTAJE_MAXIMO = 10;
export const MINIMO_MAXIMO = 1_000_000;

export interface EstadoComisionAuto {
  activa: boolean;
  /** Texto del campo, en % (0,3 = 0,3 %). */
  porcentaje: string;
  /** Texto del campo, en la moneda de la cuenta. */
  minimo: string;
}

export interface ValorComisionAuto {
  activa: boolean;
  porcentaje: number;
  minimo: number;
}

/** Número a texto de campo: sin ceros de más ni notación científica. */
const aTexto = (n: number): string => (n === 0 ? '' : String(+n.toFixed(5)));

/** Estado inicial del formulario a partir de la cuenta. Sin regla: desactivada y vacía. */
export function estadoInicialComision(banca?: Pick<Banca, 'comisionAuto'> | null): EstadoComisionAuto {
  const regla = banca?.comisionAuto;
  if (!regla) return { activa: false, porcentaje: '', minimo: '' };
  return { activa: true, porcentaje: aTexto(+(regla.tasa * 100).toFixed(3)), minimo: aTexto(regla.minimo) };
}

/** Texto de un campo numérico ('' = 0; acepta coma decimal). NaN si no es un número. */
export function leerNumero(texto: string): number {
  const limpio = texto.trim().replace(',', '.');
  if (limpio === '') return 0;
  return /^\d*\.?\d+$|^\d+\.$/.test(limpio) ? Number(limpio) : NaN;
}

export type ResultadoValidacion = { ok: true; valor: ValorComisionAuto } | { ok: false; error: string };

/** Valida el formulario. Desactivada: siempre válida (los campos se ignoran). */
export function validarComision(estado: EstadoComisionAuto): ResultadoValidacion {
  if (!estado.activa) return { ok: true, valor: { activa: false, porcentaje: 0, minimo: 0 } };
  const porcentaje = leerNumero(estado.porcentaje);
  const minimo = leerNumero(estado.minimo);
  if (Number.isNaN(porcentaje)) return { ok: false, error: 'El porcentaje debe ser un número (ej. 0,3).' };
  if (Number.isNaN(minimo)) return { ok: false, error: 'El mínimo debe ser un número (ej. 14).' };
  if (porcentaje > PORCENTAJE_MAXIMO) return { ok: false, error: `El porcentaje máximo es ${PORCENTAJE_MAXIMO} %.` };
  if (minimo > MINIMO_MAXIMO) return { ok: false, error: 'El mínimo es demasiado alto.' };
  if (porcentaje <= 0 && minimo <= 0) return { ok: false, error: 'Indica un porcentaje o un mínimo mayor a 0, o desactiva la comisión.' };
  return { ok: true, valor: { activa: true, porcentaje, minimo } };
}

/** ¿Lo escrito difiere de la regla guardada en la cuenta? (Evita llamar al servidor si no hay cambios.) */
export function comisionCambio(estado: EstadoComisionAuto, banca?: Pick<Banca, 'comisionAuto'> | null): boolean {
  const validacion = validarComision(estado);
  if (!validacion.ok) return true;
  const actual = banca?.comisionAuto ?? null;
  const { valor } = validacion;
  if (!valor.activa) return actual !== null;
  if (!actual) return true;
  return Math.round(valor.porcentaje * 1000) !== Math.round(actual.tasa * 100000) || Math.round(valor.minimo * 100) !== Math.round(actual.minimo * 100);
}

/** Comisión de un monto con la regla escrita: el mayor entre monto x % y el mínimo (a centavos). */
export function comisionDeEjemplo(monto: number, valor: ValorComisionAuto): number {
  const porPorcentaje = Math.round(monto * valor.porcentaje) / 100;
  return Math.max(porPorcentaje, valor.minimo, 0.01);
}
