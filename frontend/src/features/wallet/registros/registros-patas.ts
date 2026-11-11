/** Transferencias en dos patas para Registros (lógica pura, sin React). Se prueba en backend/tests/wallet-registros-patas.test.ts.
 *
 *  DECISIÓN: en la lista, cada transferencia se muestra como dos filas virtuales (como la app móvil de referencia):
 *   - pata "origen": sale de la cuenta origen, con su monto y moneda, signo negativo;
 *   - pata "destino": entra a la cuenta destino, con lo que ella recibe y en SU moneda, signo positivo.
 *  Sin cuentas elegidas salen las dos; con cuentas elegidas, solo las patas de esas cuentas.
 *  Mesa de cambio: la pata destino de una transferencia "en proceso" no tiene monto (queda "pendiente"); en "parcial"
 *  muestra lo ya cobrado y cuánto falta. Nunca se mezclan monedas: cada pata va en la suya y, si no se conoce lo que
 *  recibe el destino en otra moneda, el monto queda en null (se pinta "—") en vez de inventarlo.
 *
 *  ∑ (flujo neto en USD): sin filtro de cuentas las transferencias NO se suman (el dinero solo cambia de cuenta; su
 *  comisión es un egreso aparte que sí cuenta). Con filtro de cuentas SÍ se suman las patas que entran o salen de la
 *  selección, porque ahí el dinero sí entra o sale del conjunto elegido; si se eligen origen y destino se compensan.
 *  Los anulados nunca suman; una pata pendiente de mesa no suma (el dinero aún no llegó) y tampoco cuenta como
 *  "sin equivalente". */

import type { Movimiento } from '@shared/types/index.js';
import { diaDe, montoUsdDe } from '../../../lib/cochinito-kpis';
import { montoQueRecibeElDestino, montosTransferencia, ordenCronologico } from '../../cochinito/detalle-movimiento';

export type Pata = 'unica' | 'origen' | 'destino';
export type EstadoCobro = 'normal' | 'pendiente' | 'parcial';

export interface FilaVirtual {
  /** `id:pata`: única en la lista aunque la transferencia salga dos veces. */
  clave: string;
  movimiento: Movimiento;
  pata: Pata;
  /** Cuenta a la que pertenece ESTA fila (la pertinente para privacidad y filtros). */
  bancaId: string;
  /** Con signo (egreso y pata origen negativos). null = sin monto que mostrar (pendiente o desconocido). */
  monto: number | null;
  moneda: string;
  estadoCobro: EstadoCobro;
  /** Mesa: lo que aún falta cobrar en la moneda destino (solo patas destino en proceso o parcial). */
  faltaCobrar: number | null;
  /** Valor en USD del monto de la fila (absoluto); null si no se conoce o está pendiente. */
  usd: number | null;
  /** Si entra en el ∑. */
  sumable: boolean;
}

const redondear2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

interface DestinoCalculado {
  monto: number | null;
  estadoCobro: EstadoCobro;
  faltaCobrar: number | null;
  /** Fracción del valor de la transferencia que ya llegó al destino (1 = todo). */
  fraccion: number | null;
}

/** Lo que recibe la pata destino. `monedaDestino` undefined = se asume la moneda del movimiento. */
function calcularDestino(m: Movimiento, monedaDestino: string | undefined): DestinoCalculado {
  const neto = montoQueRecibeElDestino(m);
  if (!m.anulado && m.mesaCambistaId != null && m.mesaEstado === 'en_proceso') {
    return { monto: null, estadoCobro: 'pendiente', faltaCobrar: neto, fraccion: null };
  }
  if (!m.anulado && m.mesaCambistaId != null && m.mesaEstado === 'parcial') {
    const cobrado = m.mesaMontoCobrado ?? 0;
    const falta = neto == null ? null : Math.max(0, redondear2(neto - cobrado));
    const fraccion = neto != null && neto > 0 ? Math.min(1, cobrado / neto) : null;
    return { monto: cobrado, estadoCobro: 'parcial', faltaCobrar: falta, fraccion };
  }
  const mismaMoneda = monedaDestino === undefined || monedaDestino === m.moneda;
  const monto = neto ?? m.montoDestino ?? (mismaMoneda ? m.monto : null);
  return { monto, estadoCobro: 'normal', faltaCobrar: null, fraccion: 1 };
}

/** Valor en USD de TODA la transferencia (el mismo para las dos patas, para que se compensen). */
function usdDeTransferencia(m: Movimiento, monedaDestino: string | undefined): number | null {
  if (m.moneda === 'USD') return m.monto;
  return montosTransferencia(m, monedaDestino)?.usd ?? montoUsdDe(m);
}

function filaUnica(m: Movimiento): FilaVirtual {
  const usd = montoUsdDe(m);
  return {
    clave: `${m.id}:unica`, movimiento: m, pata: 'unica', bancaId: m.bancaOrigenId,
    monto: m.tipo === 'egreso' ? -m.monto : m.monto, moneda: m.moneda,
    estadoCobro: 'normal', faltaCobrar: null, usd, sumable: true,
  };
}

function pataOrigen(m: Movimiento, usd: number | null): FilaVirtual {
  return {
    clave: `${m.id}:origen`, movimiento: m, pata: 'origen', bancaId: m.bancaOrigenId,
    monto: -m.monto, moneda: m.moneda, estadoCobro: 'normal', faltaCobrar: null, usd, sumable: true,
  };
}

function pataDestino(m: Movimiento, bancaId: string, monedaDestino: string | undefined, usdTotal: number | null): FilaVirtual {
  const d = calcularDestino(m, monedaDestino);
  const pendiente = d.estadoCobro === 'pendiente';
  const usd = pendiente || usdTotal == null ? null : d.fraccion == null ? null : redondear2(usdTotal * d.fraccion);
  return {
    clave: `${m.id}:destino`, movimiento: m, pata: 'destino', bancaId,
    monto: d.monto, moneda: monedaDestino ?? m.moneda, estadoCobro: d.estadoCobro, faltaCobrar: d.faltaCobrar,
    usd, sumable: !pendiente,
  };
}

/** Una pata solo existe si la cuenta es visible para el usuario (el backend filtra las cuentas por permiso): sin ella no
 *  se conoce su moneda y se estaría mostrando lo que recibe o envía una cuenta ajena. */
function patasDe(m: Movimiento, monedas: ReadonlyMap<string, string>): FilaVirtual[] {
  if (m.tipo !== 'transferencia') return [filaUnica(m)];
  const monedaDestino = m.bancaDestinoId ? monedas.get(m.bancaDestinoId) : undefined;
  const usdTotal = usdDeTransferencia(m, monedaDestino);
  const filas: FilaVirtual[] = [];
  if (monedas.has(m.bancaOrigenId)) filas.push(pataOrigen(m, usdTotal));
  if (m.bancaDestinoId && monedaDestino !== undefined) filas.push(pataDestino(m, m.bancaDestinoId, monedaDestino, usdTotal));
  return filas;
}

/**
 * Filas de la lista: una por movimiento y dos por transferencia (origen y destino). Con `cuentasElegidas` solo quedan
 * las filas de esas cuentas. Conserva el orden recibido (origen antes que destino). No muta la entrada.
 */
export function expandirPatas(
  movimientos: readonly Movimiento[],
  monedasCuentas: ReadonlyMap<string, string>,
  cuentasElegidas: readonly string[],
): FilaVirtual[] {
  const elegidas = new Set(cuentasElegidas);
  return movimientos
    .flatMap(m => patasDe(m, monedasCuentas))
    .filter(f => elegidas.size === 0 || elegidas.has(f.bancaId));
}

/** USD que se muestra bajo el monto: solo si la fila está en Bs y se conoce el equivalente. */
export function usdParaMostrar(fila: Pick<FilaVirtual, 'moneda' | 'usd'>): number | null {
  return fila.moneda === 'VES' ? fila.usd : null;
}

export interface FlujoUsd {
  /** Ingresos menos egresos en USD (centavos). */
  netoUsd: number;
  /** Filas vigentes sin equivalente en USD: no entran en la suma. */
  sinEquivalente: number;
}

const signoDe = (f: FilaVirtual): 1 | -1 =>
  f.pata === 'origen' ? -1 : f.pata === 'destino' ? 1 : f.movimiento.tipo === 'ingreso' ? 1 : -1;

/** ∑ de las filas. `incluirTransferencias` = hay filtro de cuentas (ver el comentario del archivo). */
export function flujoNetoUsdFilas(filas: readonly FilaVirtual[], incluirTransferencias: boolean): FlujoUsd {
  let neto = 0;
  let sinEquivalente = 0;
  for (const f of filas) {
    if (f.movimiento.anulado || !f.sumable) continue;
    if (f.pata !== 'unica' && !incluirTransferencias) continue;
    if (f.usd == null) { sinEquivalente += 1; continue; }
    neto += signoDe(f) * f.usd;
  }
  return { netoUsd: redondear2(neto), sinEquivalente };
}

/** Ids para anterior/siguiente en el detalle: sin repetir (una transferencia son dos filas) y en orden cronológico. */
export function idsNavegacionDeFilas(filas: readonly FilaVirtual[]): string[] {
  const unicos = new Map<string, Movimiento>();
  for (const f of filas) if (!unicos.has(f.movimiento.id)) unicos.set(f.movimiento.id, f.movimiento);
  return ordenCronologico([...unicos.values()].filter(m => diaDe(m))).map(m => m.id);
}
