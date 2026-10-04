/** Lógica pura de la pantalla /cochinito (sin React): filtros, periodo anterior, indicadores y series de gráficas.
 *  Solo presentación: no toca servicios ni reglas de negocio. Se prueba en backend/tests/cochinito-kpis.test.ts. */

import type { Banca, Movimiento } from '@shared/types/index.js';
import { formatearFechaCorta } from './formato';

export const TIPOS_MOVIMIENTO = ['ingreso', 'egreso', 'transferencia'] as const;
export const SUBTIPOS_EGRESO = ['pago', 'adelanto'] as const;

export interface FiltrosCochinito {
  tipo?: string;
  banca?: string;
  q?: string;
  desde?: string;
  hasta?: string;
  subtipo?: string;
}

const DIA_MS = 86400000;
const aIso = (d: Date) => d.toISOString().slice(0, 10);
const aFechaUtc = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** "AAAA-MM-DD" de la fecha del movimiento (acepta también un timestamp ISO). */
export function diaDe(m: Pick<Movimiento, 'fecha'>): string {
  return (m.fecha ?? '').slice(0, 10);
}

/** Correlativo "PG-0001" / "AD-0002"; "—" si el movimiento no es pago ni adelanto. */
export function correlativoMovimiento(m: Pick<Movimiento, 'subtipo' | 'numero'>): string {
  if (m.numero == null || !m.subtipo) return '—';
  const prefijo = m.subtipo === 'pago' ? 'PG' : 'AD';
  return `${prefijo}-${String(m.numero).padStart(4, '0')}`;
}

/** Equivalente en USD: el campo montoUsd si existe; si no, el monto cuando ya está en USD; si no, null (desconocido). */
export function montoUsdDe(m: Pick<Movimiento, 'monto' | 'moneda' | 'montoUsd'>): number | null {
  if (m.montoUsd != null && Number.isFinite(m.montoUsd)) return m.montoUsd;
  return m.moneda === 'USD' ? m.monto : null;
}

const normalizar = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export type NombreContraparte = (m: Movimiento) => string | null;

/** Filtra los movimientos con los filtros de la URL. Todos son opcionales y se combinan con "y". Devuelve un arreglo NUEVO. */
export function filtrarMovimientos(
  movimientos: readonly Movimiento[],
  f: FiltrosCochinito,
  nombreContraparte?: NombreContraparte,
): Movimiento[] {
  const q = f.q ? normalizar(f.q.trim()) : '';
  return movimientos.filter(m => {
    if (f.tipo && m.tipo !== f.tipo) return false;
    if (f.subtipo && m.subtipo !== f.subtipo) return false;
    if (f.banca && m.bancaOrigenId !== f.banca && m.bancaDestinoId !== f.banca) return false;
    const dia = diaDe(m);
    if (f.desde && dia < f.desde) return false;
    if (f.hasta && dia > f.hasta) return false;
    if (q) {
      const texto = normalizar([m.descripcion, m.referencia, correlativoMovimiento(m), nombreContraparte?.(m) ?? ''].join(' '));
      if (!texto.includes(q)) return false;
    }
    return true;
  });
}

/** Solo el periodo (sin los demás filtros). */
export function movimientosDelPeriodo(movimientos: readonly Movimiento[], desde: string, hasta: string): Movimiento[] {
  return filtrarMovimientos(movimientos, { desde, hasta });
}

/** Periodo anterior de igual duración, terminando el día antes de `desde`. */
export function periodoAnterior(desde: string, hasta: string): { desde: string; hasta: string } {
  const d = aFechaUtc(desde).getTime();
  const h = aFechaUtc(hasta).getTime();
  const dias = Math.round((h - d) / DIA_MS) + 1;
  return { desde: aIso(new Date(d - dias * DIA_MS)), hasta: aIso(new Date(d - DIA_MS)) };
}

/** Primera fecha con datos (la más antigua), o null si no hay movimientos. */
export function primeraFecha(movimientos: readonly Movimiento[]): string | null {
  let min: string | null = null;
  for (const m of movimientos) {
    const d = diaDe(m);
    if (d && (min === null || d < min)) min = d;
  }
  return min;
}

/** El periodo anterior es comparable solo si los datos empiezan antes o el mismo día en que ese periodo empieza. */
export function hayHistorialComparable(primera: string | null, anterior: { desde: string }): boolean {
  return primera !== null && primera <= anterior.desde;
}

export interface ResumenEgresos {
  totalUsd: number;
  pagosUsd: number;
  adelantosUsd: number;
  otrosUsd: number;
  cantidad: number;
  cantidadPagos: number;
  cantidadAdelantos: number;
  /** Egresos que no se pudieron convertir a USD (no entran en las sumas). */
  sinEquivalente: number;
}

/** Suma los egresos en USD (los movimientos sin equivalente en USD se cuentan aparte, no se inventan). */
export function resumirEgresos(movimientos: readonly Movimiento[]): ResumenEgresos {
  const r: ResumenEgresos = { totalUsd: 0, pagosUsd: 0, adelantosUsd: 0, otrosUsd: 0, cantidad: 0, cantidadPagos: 0, cantidadAdelantos: 0, sinEquivalente: 0 };
  for (const m of movimientos) {
    if (m.tipo !== 'egreso') continue;
    r.cantidad += 1;
    if (m.subtipo === 'pago') r.cantidadPagos += 1;
    if (m.subtipo === 'adelanto') r.cantidadAdelantos += 1;
    const usd = montoUsdDe(m);
    if (usd == null) { r.sinEquivalente += 1; continue; }
    r.totalUsd += usd;
    if (m.subtipo === 'pago') r.pagosUsd += usd;
    else if (m.subtipo === 'adelanto') r.adelantosUsd += usd;
    else r.otrosUsd += usd;
  }
  return r;
}

export interface KpisCochinito {
  saldoUsd: number;
  bancasUsd: number;
  saldoVes: number;
  bancasVes: number;
  /** Bancas activas con saldo negativo. */
  bancasNegativas: number;
  periodo: ResumenEgresos;
  /** null = no hay historial comparable (no se muestra 0 % ni +100 % engañosos). */
  anterior: ResumenEgresos | null;
}

/** Indicadores de la pantalla. Los saldos son de las bancas ACTIVAS; los egresos, del periodo y su periodo anterior. */
export function calcularKpis(
  bancas: readonly Banca[],
  movimientos: readonly Movimiento[],
  periodo: { desde: string; hasta: string },
): KpisCochinito {
  const activas = bancas.filter(b => !b.archivada);
  const usd = activas.filter(b => b.moneda === 'USD');
  const ves = activas.filter(b => b.moneda === 'VES');
  const previo = periodoAnterior(periodo.desde, periodo.hasta);
  const comparable = hayHistorialComparable(primeraFecha(movimientos), previo);
  return {
    saldoUsd: usd.reduce((s, b) => s + b.saldo, 0),
    bancasUsd: usd.length,
    saldoVes: ves.reduce((s, b) => s + b.saldo, 0),
    bancasVes: ves.length,
    bancasNegativas: activas.filter(b => b.saldo < 0).length,
    periodo: resumirEgresos(movimientosDelPeriodo(movimientos, periodo.desde, periodo.hasta)),
    anterior: comparable ? resumirEgresos(movimientosDelPeriodo(movimientos, previo.desde, previo.hasta)) : null,
  };
}

/** Lunes (ISO) de la semana de una fecha "AAAA-MM-DD". */
export function lunesDeSemana(dia: string): string {
  const d = aFechaUtc(dia);
  const desfase = (d.getUTCDay() + 6) % 7;
  return aIso(new Date(d.getTime() - desfase * DIA_MS));
}

export interface SeriesSemanales {
  /** Etiquetas "dd/mm" (lunes de cada semana). */
  categorias: string[];
  /** Lunes en ISO, paralelo a `categorias`. */
  lunes: string[];
  pagos: number[];
  adelantos: number[];
  otros: number[];
  total: number[];
}

/** Egresos (o el tipo indicado) por semana en USD, rellenando las semanas vacías entre la primera y la última. */
export function serieSemanal(movimientos: readonly Movimiento[], tipo: 'egreso' | 'ingreso' = 'egreso'): SeriesSemanales {
  const base = movimientos.filter(m => m.tipo === tipo && diaDe(m) && montoUsdDe(m) != null);
  const vacio: SeriesSemanales = { categorias: [], lunes: [], pagos: [], adelantos: [], otros: [], total: [] };
  if (base.length === 0) return vacio;
  const dias = base.map(m => lunesDeSemana(diaDe(m))).sort();
  const lunes: string[] = [];
  for (let t = aFechaUtc(dias[0]).getTime(); t <= aFechaUtc(dias[dias.length - 1]).getTime(); t += 7 * DIA_MS) lunes.push(aIso(new Date(t)));
  const indice = new Map(lunes.map((l, i) => [l, i]));
  const pagos = lunes.map(() => 0);
  const adelantos = lunes.map(() => 0);
  const otros = lunes.map(() => 0);
  for (const m of base) {
    const i = indice.get(lunesDeSemana(diaDe(m)))!;
    const usd = montoUsdDe(m)!;
    if (m.subtipo === 'pago') pagos[i] += usd;
    else if (m.subtipo === 'adelanto') adelantos[i] += usd;
    else otros[i] += usd;
  }
  return { categorias: lunes.map(l => formatearFechaCorta(l)), lunes, pagos, adelantos, otros, total: lunes.map((_, i) => pagos[i] + adelantos[i] + otros[i]) };
}

export interface SaldoBanca {
  id: string;
  nombre: string;
  moneda: string;
  saldo: number;
}

/** Saldos de las bancas activas, ordenados de mayor a menor dentro de cada moneda. */
export function saldosPorBanca(bancas: readonly Banca[]): SaldoBanca[] {
  return bancas
    .filter(b => !b.archivada)
    .map(b => ({ id: b.id, nombre: b.nombre, moneda: b.moneda, saldo: b.saldo }))
    .sort((a, b) => a.moneda.localeCompare(b.moneda) || b.saldo - a.saldo);
}

export interface PuntoTasa {
  etiqueta: string;
  valor: number;
  dia: string;
}

/** Historial de tasa (viene del más nuevo al más viejo) -> puntos del más viejo al más nuevo, uno por día (el último del día). */
export function puntosDeTasa(historial: ReadonlyArray<{ tasa: number; fecha: string }>): PuntoTasa[] {
  const porDia = new Map<string, { tasa: number; fecha: string }>();
  for (const h of historial) {
    if (!Number.isFinite(h.tasa)) continue;
    const dia = h.fecha.slice(0, 10);
    const previo = porDia.get(dia);
    if (!previo || h.fecha > previo.fecha) porDia.set(dia, h);
  }
  return [...porDia.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([dia, h]) => ({ etiqueta: formatearFechaCorta(dia), valor: h.tasa, dia }));
}
