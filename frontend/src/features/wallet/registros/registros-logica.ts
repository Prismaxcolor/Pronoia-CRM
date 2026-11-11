/** Lógica pura de la pantalla Registros de la Wallet nueva (sin React): semanas ISO, fechas relativas, totales en USD,
 *  cuentas de cada fila y filtro de cuentas. Se prueba en backend/tests/wallet-registros.test.ts.
 *  Solo presentación: no toca saldos ni reglas de negocio. */

import type { Movimiento } from '@shared/types/index.js';
import { diaDe, montoUsdDe } from '../../../lib/cochinito-kpis';
import { montoQueRecibeElDestino } from '../../cochinito/detalle-movimiento';

const DIA_MS = 86400000;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const;

const aFecha = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
const aIso = (d: Date): string => d.toISOString().slice(0, 10);

export interface SemanaIso {
  /** Año al que pertenece la semana ISO (puede diferir del año de la fecha en los bordes). */
  anio: number;
  semana: number;
  lunes: string;
  domingo: string;
}

/** Semana ISO 8601 de una fecha "AAAA-MM-DD" (la semana pertenece al año de su jueves). */
export function semanaIsoDe(dia: string): SemanaIso {
  const d = aFecha(dia);
  const lunes = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DIA_MS);
  const jueves = new Date(lunes.getTime() + 3 * DIA_MS);
  const anio = jueves.getUTCFullYear();
  const primerJueves = new Date(Date.UTC(anio, 0, 4));
  const lunesSemana1 = new Date(primerJueves.getTime() - ((primerJueves.getUTCDay() + 6) % 7) * DIA_MS);
  const semana = Math.round((lunes.getTime() - lunesSemana1.getTime()) / (7 * DIA_MS)) + 1;
  return { anio, semana, lunes: aIso(lunes), domingo: aIso(new Date(lunes.getTime() + 6 * DIA_MS)) };
}

const partes = (iso: string) => ({ anio: Number(iso.slice(0, 4)), mes: Number(iso.slice(5, 7)) - 1, dia: Number(iso.slice(8, 10)) });

/** "9 – 15 nov", "26 oct – 1 nov" o, si cruza de año, "28 dic 2026 – 3 ene 2027". */
export function etiquetaRangoSemana(lunes: string, domingo: string): string {
  const a = partes(lunes);
  const b = partes(domingo);
  if (a.anio !== b.anio) return `${a.dia} ${MESES[a.mes]} ${a.anio} – ${b.dia} ${MESES[b.mes]} ${b.anio}`;
  if (a.mes !== b.mes) return `${a.dia} ${MESES[a.mes]} – ${b.dia} ${MESES[b.mes]}`;
  return `${a.dia} – ${b.dia} ${MESES[b.mes]}`;
}

/** "Hoy", "Ayer" o "9 nov" (con el año si no es el actual). `hoy` es "AAAA-MM-DD". */
export function textoFecha(dia: string, hoy: string): string {
  if (dia === hoy) return 'Hoy';
  if (dia === aIso(new Date(aFecha(hoy).getTime() - DIA_MS))) return 'Ayer';
  const p = partes(dia);
  const base = `${p.dia} ${MESES[p.mes]}`;
  return p.anio === partes(hoy).anio ? base : `${base} ${p.anio}`;
}

export interface GrupoSemana {
  /** Lunes de la semana: clave estable de la lista. */
  clave: string;
  semana: SemanaIso;
  movimientos: Movimiento[];
}

/** Más reciente primero: fecha, luego hora de registro, luego id. */
const masRecientePrimero = (a: Movimiento, b: Movimiento): number =>
  diaDe(b).localeCompare(diaDe(a)) || (b.creadoEn ?? '').localeCompare(a.creadoEn ?? '') || b.id.localeCompare(a.id);

/** Agrupa por semana ISO, de la más reciente a la más antigua. No muta la entrada. Ignora movimientos sin fecha. */
export function agruparPorSemana(movimientos: readonly Movimiento[]): GrupoSemana[] {
  const porLunes = new Map<string, GrupoSemana>();
  for (const m of [...movimientos].filter(x => diaDe(x)).sort(masRecientePrimero)) {
    const semana = semanaIsoDe(diaDe(m));
    const grupo = porLunes.get(semana.lunes);
    if (grupo) grupo.movimientos.push(m);
    else porLunes.set(semana.lunes, { clave: semana.lunes, semana, movimientos: [m] });
  }
  return [...porLunes.values()].sort((a, b) => b.clave.localeCompare(a.clave));
}

/** Quita movimientos repetidos por id (la paginación por offset puede devolver una fila dos veces); conserva la primera. */
export function deduplicarPorId(movimientos: readonly Movimiento[]): Movimiento[] {
  const vistos = new Set<string>();
  return movimientos.filter(m => (vistos.has(m.id) ? false : (vistos.add(m.id), true)));
}

export interface FlujoUsd {
  /** Ingresos menos egresos en USD (centavos). */
  netoUsd: number;
  /** Ingresos/egresos vigentes sin equivalente en USD: no entran en la suma. */
  sinEquivalente: number;
}

const redondear2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Flujo neto en USD. Las transferencias no cambian el total (el dinero pasa de una cuenta a otra; su comisión
 * es un egreso aparte que sí cuenta) y los anulados no cuentan. Lo que no tiene equivalente USD no se inventa.
 */
export function flujoNetoUsd(movimientos: readonly Movimiento[]): FlujoUsd {
  let neto = 0;
  let sinEquivalente = 0;
  for (const m of movimientos) {
    if (m.anulado || m.tipo === 'transferencia') continue;
    const usd = montoUsdDe(m);
    if (usd == null) { sinEquivalente += 1; continue; }
    neto += m.tipo === 'ingreso' ? usd : -usd;
  }
  return { netoUsd: redondear2(neto), sinEquivalente };
}

/** Ids de cuentas del parámetro `banca` de la URL ("id1,id2"), sin vacíos ni repetidos. */
export function parsearCuentas(texto: string | null | undefined): string[] {
  const ids = (texto ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return [...new Set(ids)];
}

/** Valor del parámetro `banca`; undefined si no hay ninguna (para quitarlo de la URL). */
export function serializarCuentas(ids: readonly string[]): string | undefined {
  return ids.length > 0 ? ids.join(',') : undefined;
}

/** Movimientos que tocan alguna de las cuentas (origen o destino). Sin ids devuelve todos. */
export function filtrarPorCuentas(movimientos: readonly Movimiento[], ids: readonly string[]): Movimiento[] {
  if (ids.length === 0) return [...movimientos];
  const set = new Set(ids);
  return movimientos.filter(m => set.has(m.bancaOrigenId) || (m.bancaDestinoId != null && set.has(m.bancaDestinoId)));
}

/** Check verde: vigente y, si es una transferencia con mesa de cambio, ya completada. */
export function esCompleto(m: Pick<Movimiento, 'anulado' | 'mesaCambistaId' | 'mesaEstado'>): boolean {
  if (m.anulado) return false;
  return m.mesaCambistaId == null || m.mesaEstado === 'completada';
}

export function tituloMovimiento(m: Pick<Movimiento, 'tipo' | 'comisionDeId' | 'mesaComisionDeId'>, nombreCategoria: string | null): string {
  if (m.tipo === 'transferencia') return 'Transferir, retirar';
  if (m.mesaComisionDeId != null) return 'Comisión de mesa de cambio';
  if (m.comisionDeId != null) return 'Comisión bancaria';
  return nombreCategoria ?? 'Movimiento sin categoría';
}

export const CUENTA_NO_DISPONIBLE = 'Cuenta no disponible';

export interface CuentasFila {
  origen: string;
  destino: string | null;
}

/** Nombres de la cuenta de la fila (o de origen y destino en una transferencia). */
export function cuentasDeFila(m: Pick<Movimiento, 'bancaOrigenId' | 'bancaDestinoId' | 'tipo'>, nombres: ReadonlyMap<string, string>): CuentasFila {
  const nombre = (id: string): string => nombres.get(id) ?? CUENTA_NO_DISPONIBLE;
  const conDestino = m.tipo === 'transferencia' && m.bancaDestinoId != null;
  return { origen: nombre(m.bancaOrigenId), destino: conDestino && m.bancaDestinoId ? nombre(m.bancaDestinoId) : null };
}

export type TonoMonto = 'negativo' | 'positivo' | 'neutro';

export interface MontoFila {
  /** Con signo: egreso negativo; ingreso y transferencia positivos. */
  monto: number;
  moneda: string;
  tono: TonoMonto;
  /** Solo transferencias entre monedas distintas: lo que recibe (o recibirá) la cuenta destino. */
  destino: { monto: number; moneda: string } | null;
}

function destinoDe(m: Movimiento, monedaDestino: string | undefined): MontoFila['destino'] {
  if (m.tipo !== 'transferencia' || !monedaDestino || monedaDestino === m.moneda) return null;
  const recibe = montoQueRecibeElDestino(m) ?? m.montoDestino;
  return recibe == null ? null : { monto: recibe, moneda: monedaDestino };
}

/** Monto que se muestra a la derecha de la fila. Nunca mezcla monedas: cada monto va en la suya. */
export function montoDeFila(m: Movimiento, monedaDestino: string | undefined): MontoFila {
  const destino = destinoDe(m, monedaDestino);
  if (m.tipo === 'transferencia') return { monto: m.monto, moneda: m.moneda, tono: 'neutro', destino };
  const tono: TonoMonto = m.anulado ? 'neutro' : m.tipo === 'ingreso' ? 'positivo' : 'negativo';
  return { monto: m.tipo === 'egreso' ? -m.monto : m.monto, moneda: m.moneda, tono, destino };
}
