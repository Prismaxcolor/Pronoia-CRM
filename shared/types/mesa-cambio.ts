/**
 * Mesa de cambio: cambistas (proveedores de cambio de divisas) y su estado de cuenta en USD.
 *
 * Los asientos manuales son anotaciones de deuda: NO mueven saldos de Wallet ni de bancas. Los asientos
 * ligados a una transferencia con mesa de cambio (movimientoId) los crean y anulan las RPC de esa transferencia.
 * Convención: CARGO y N/D (nota de débito) aumentan lo que les debemos; COBRO y N/C (nota de crédito) lo reducen
 * (o lo vuelven a nuestro favor).
 * saldo = suma de (cargos + N/D) - suma de (cobros + N/C), sin anulados. Positivo = "Les debemos"; negativo = "Nos deben".
 *
 * El cálculo del estado de cuenta vive en el servidor (backend/src/utils/mesa-cambio.ts); aquí solo van los
 * tipos del contrato y la descripción legible del saldo, que usa la pantalla.
 */

export const TIPOS_ASIENTO = ['CARGO', 'COBRO', 'NC', 'ND'] as const;
export type TipoAsiento = (typeof TIPOS_ASIENTO)[number];

export const ETIQUETA_TIPO_ASIENTO: Record<TipoAsiento, string> = {
  CARGO: 'Cargo (aumenta lo que les debemos)',
  COBRO: 'Cobro / abono (reduce lo que les debemos)',
  NC: 'Nota de crédito (reduce lo que les debemos)',
  ND: 'Nota de débito (aumenta lo que les debemos)',
};

/** Etiqueta corta del tipo, para la columna "Detalle" del estado de cuenta. */
export const ETIQUETA_CORTA_TIPO_ASIENTO: Record<TipoAsiento, string> = {
  CARGO: 'Cargo', COBRO: 'Cobro', NC: 'Nota de crédito', ND: 'Nota de débito',
};

export interface Cambista {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  notas: string | null;
  activo: boolean;
  creadoEn: string;
}

export interface CambistaConSaldo extends Cambista {
  /** Cargos - cobros vigentes, en USD. Positivo = les debemos; negativo = nos deben. */
  saldo: number;
  asientos: number;
}

export interface FilaEstadoCuentaMesa {
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
  /** Correlativo propio de las notas (NC-0001 / ND-0001); null en CARGO y COBRO. */
  numeroNota: number | null;
  /** Transferencia de Wallet de la que nace el asiento; null si es un asiento manual. */
  movimientoId: string | null;
  /** Efecto en el saldo: 0 si está anulado. */
  cargo: number;
  cobro: number;
  saldoCorrido: number;
}

export interface EstadoCuentaMesa {
  cambista: Cambista;
  desde: string | null;
  hasta: string | null;
  saldoInicial: number;
  filas: FilaEstadoCuentaMesa[];
  totalCargos: number;
  totalCobros: number;
  saldoFinal: number;
}

/** Correlativo propio por asiento: MC-0001. Espejo de backend/src/utils/mesa-cambio.ts. */
export function formatearNumeroAsiento(numero: number): string {
  return `MC-${String(numero).padStart(4, '0')}`;
}

const PREFIJO_NOTA: Partial<Record<TipoAsiento, string>> = { NC: 'NC', ND: 'ND' };

/** Número visible: NC-0001 / ND-0001 para las notas; MC-0001 para el resto. Espejo de backend/src/utils/mesa-cambio.ts. */
export function formatearNumeroDocumento(a: { tipo: TipoAsiento; numero: number; numeroNota?: number | null }): string {
  const prefijo = PREFIJO_NOTA[a.tipo];
  if (prefijo && a.numeroNota != null) return `${prefijo}-${String(a.numeroNota).padStart(4, '0')}`;
  return formatearNumeroAsiento(a.numero);
}

/** Por debajo de medio centavo el saldo se considera en cero. */
const SALDO_NULO_USD = 0.005;

export type SentidoSaldo = 'les_debemos' | 'nos_deben' | 'en_cero';

export interface DescripcionSaldo {
  sentido: SentidoSaldo;
  /** Importe absoluto en USD. */
  monto: number;
  /** "Les debemos" / "Nos deben" / "Al día" (sin importe). */
  etiqueta: string;
  /** Frase completa con el importe, ya formateado es-VE. */
  texto: string;
}

const formatearUsd = (n: number): string =>
  `USD ${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function describirSaldo(saldo: number): DescripcionSaldo {
  if (Math.abs(saldo) < SALDO_NULO_USD) {
    return { sentido: 'en_cero', monto: 0, etiqueta: 'Al día', texto: 'Al día (saldo en cero)' };
  }
  const monto = Math.round(Math.abs(saldo) * 100) / 100;
  if (saldo > 0) return { sentido: 'les_debemos', monto, etiqueta: 'Les debemos', texto: `Les debemos ${formatearUsd(monto)}` };
  return { sentido: 'nos_deben', monto, etiqueta: 'Nos deben', texto: `Nos deben ${formatearUsd(monto)}` };
}
