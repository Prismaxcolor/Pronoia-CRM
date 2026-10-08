/**
 * Lógica pura de la Mesa de cambio (sin base de datos). Contrato compartido: shared/types/mesa-cambio.ts
 * (el formato del correlativo se duplica porque @shared no resuelve en runtime con tsx + ESM).
 *
 * Los importes se suman en centavos enteros para no arrastrar error de coma flotante.
 * Todo devuelve valores nuevos; nunca se muta la entrada.
 */

export type TipoAsiento = 'CARGO' | 'COBRO';

export interface AsientoMesa {
  id: string;
  numero: number;
  tipo: TipoAsiento;
  montoUsd: number;
  fecha: string;
  anulado: boolean;
  tasa?: number | null;
  nota?: string | null;
  referencia?: string | null;
  anuladoMotivo?: string | null;
}

export interface FilaEstado {
  id: string;
  numero: number;
  tipo: TipoAsiento;
  fecha: string;
  montoUsd: number;
  tasa: number | null;
  nota: string | null;
  referencia: string | null;
  anulado: boolean;
  anuladoMotivo: string | null;
  cargo: number;
  cobro: number;
  saldoCorrido: number;
}

export interface EstadoCuentaCalculado {
  saldoInicial: number;
  filas: FilaEstado[];
  totalCargos: number;
  totalCobros: number;
  saldoFinal: number;
}

export interface RangoFechas {
  desde?: string | null;
  hasta?: string | null;
}

type ConImporte = Pick<AsientoMesa, 'tipo' | 'montoUsd' | 'anulado'>;

const aCentavos = (n: number): number => Math.round((Number(n) || 0) * 100);

/** Efecto del asiento en el saldo, en centavos: CARGO suma, COBRO resta, anulado 0. */
function centavosFirmados(a: ConImporte): number {
  if (a.anulado) return 0;
  const c = aCentavos(a.montoUsd);
  return a.tipo === 'CARGO' ? c : -c;
}

export function importeFirmado(a: ConImporte): number {
  return centavosFirmados(a) / 100;
}

export function saldoDeAsientos(asientos: readonly ConImporte[]): number {
  return asientos.reduce((acc, a) => acc + centavosFirmados(a), 0) / 100;
}

export function formatearNumeroAsiento(numero: number): string {
  return `MC-${String(numero).padStart(4, '0')}`;
}

const porFechaYNumero = (a: AsientoMesa, b: AsientoMesa): number =>
  a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.numero - b.numero;

function dentroDelRango(a: AsientoMesa, { desde, hasta }: RangoFechas): boolean {
  return (!desde || a.fecha >= desde) && (!hasta || a.fecha <= hasta);
}

/**
 * Estado de cuenta de un cambista: saldo inicial (todo lo vigente anterior a `desde`), filas del rango
 * con saldo corrido y totales. Los asientos anulados aparecen con efecto 0.
 */
export function construirEstadoCuenta(asientos: readonly AsientoMesa[], rango: RangoFechas): EstadoCuentaCalculado {
  const ordenados = [...asientos].sort(porFechaYNumero);
  const desde = rango.desde;
  const inicial = desde ? ordenados.filter(a => a.fecha < desde).reduce((acc, a) => acc + centavosFirmados(a), 0) : 0;

  let corrido = inicial;
  let cargos = 0;
  let cobros = 0;
  const filas = ordenados.filter(a => dentroDelRango(a, rango)).map((a): FilaEstado => {
    const efecto = centavosFirmados(a);
    corrido += efecto;
    if (efecto > 0) cargos += efecto;
    else cobros -= efecto;
    return {
      id: a.id, numero: a.numero, tipo: a.tipo, fecha: a.fecha, montoUsd: a.montoUsd,
      tasa: a.tasa ?? null, nota: a.nota ?? null, referencia: a.referencia ?? null,
      anulado: a.anulado, anuladoMotivo: a.anuladoMotivo ?? null,
      cargo: efecto > 0 ? efecto / 100 : 0,
      cobro: efecto < 0 ? -efecto / 100 : 0,
      saldoCorrido: corrido / 100,
    };
  });
  return { saldoInicial: inicial / 100, filas, totalCargos: cargos / 100, totalCobros: cobros / 100, saldoFinal: corrido / 100 };
}
