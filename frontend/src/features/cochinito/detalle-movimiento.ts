import { correlativoMovimiento, diaDe, montoUsdDe } from '../../lib/cochinito-kpis';
import type { Movimiento } from '@shared/types/index.js';

const SIN_NUMERO = '—';
const DIGITOS_NUMERO_MANUAL = 6;
const PREFIJO_WALLET = 'MV';
const DIGITOS_WALLET = 4;

export const ETIQUETA_TIPO_MOVIMIENTO = { ingreso: 'Ingreso', egreso: 'Egreso', transferencia: 'Transferencia' } as const;
export const ETIQUETA_SUBTIPO_MOVIMIENTO = { pago: 'Pago', adelanto: 'Adelanto', cobro: 'Cobro', anticipo: 'Anticipo' } as const;

/** Ruta del detalle de un movimiento. */
export const rutaDetalleMovimiento = (id: string): string => `/cochinito/movimientos/${id}`;

/** Correlativo del sistema de un movimiento manual de Wallet: 5 -> "MV-0005". */
export const formatCodigoMovimientoWallet = (numeroSistema: number): string =>
  `${PREFIJO_WALLET}-${String(numeroSistema).padStart(DIGITOS_WALLET, '0')}`;

/**
 * N° del movimiento. Los pagos, adelantos, cobros y anticipos conservan su correlativo propio (PG-0001, AD-0001...).
 * Los movimientos manuales de Wallet usan el correlativo del sistema (MV-0001); si no lo tienen (movimientos
 * anteriores a la migración) se cae al `numero` con formato N000123. Sin número: "—".
 */
export function numeroMovimiento(m: Pick<Movimiento, 'subtipo' | 'numero'> & { numeroSistema?: number | null }): string {
  const correlativo = correlativoMovimiento(m);
  if (correlativo !== SIN_NUMERO) return correlativo;
  if (m.numeroSistema != null) return formatCodigoMovimientoWallet(m.numeroSistema);
  return m.numero == null ? SIN_NUMERO : `N${String(m.numero).padStart(DIGITOS_NUMERO_MANUAL, '0')}`;
}

/** Bolívares por dólar implícitos en el movimiento; null si no aplica (ya está en USD o falta el equivalente). */
export function tasaDe(m: Pick<Movimiento, 'monto' | 'moneda' | 'montoUsd'> & { equivalenteUsd?: number | null }): number | null {
  const usd = m.montoUsd ?? m.equivalenteUsd ?? null;
  if (m.moneda === 'USD' || usd == null || !(usd > 0) || !(m.monto > 0)) return null;
  return m.monto / usd;
}

export interface MontosTransferencia {
  /** Monto en bolívares (siempre se muestra primero). */
  bs: number;
  /** Equivalente en USD; null si no hay dato ni tasa. */
  usd: number | null;
}

/**
 * Transferencia con una punta en bolívares: el monto en Bs y, después, su equivalente en USD.
 * Origen en Bs: lo que sale en Bs. Origen en USD y destino en Bs: lo que recibe el destino (en Bs) y los USD enviados.
 * null si no es una transferencia o ninguna punta es en bolívares.
 */
export function montosTransferencia(
  m: Pick<Movimiento, 'tipo' | 'monto' | 'moneda' | 'montoUsd' | 'montoDestino' | 'mesaCambistaId' | 'mesaEstado' | 'mesaMontoBruto' | 'mesaComision'> & { equivalenteUsd?: number | null },
  monedaDestino?: string,
): MontosTransferencia | null {
  if (m.tipo !== 'transferencia') return null;
  if (m.moneda === 'VES') {
    // VES -> USD: los USD realmente recibidos (montoDestino) mandan sobre el estimado a tasa.
    const usdRecibido = monedaDestino === 'USD' && m.montoDestino != null && m.montoDestino > 0 ? m.montoDestino : null;
    return { bs: m.monto, usd: usdRecibido ?? montoUsdDe(m) };
  }
  if (monedaDestino !== 'VES') return null;
  const bs = montoQueRecibeElDestino(m) ?? m.montoDestino;
  return bs == null ? null : { bs, usd: montoUsdDe(m) };
}

/** Solo los movimientos manuales vigentes se editan o anulan desde Wallet; los de un pago o cobro, desde su comprobante. */
export const esManualVigente = (m: Pick<Movimiento, 'anulado' | 'grupoId' | 'subtipo'>): boolean =>
  !m.anulado && !m.grupoId && !m.subtipo;

/** Ruta del comprobante de pago/cobro/cruce al que pertenece el movimiento; null si es un movimiento suelto. */
export function rutaComprobanteOperacion(m: Pick<Movimiento, 'grupoId' | 'proveedorId' | 'clienteId'>): string | null {
  if (!m.grupoId) return null;
  if (m.proveedorId) return `/proveedores/${m.proveedorId}/pagos/${m.grupoId}`;
  if (m.clienteId) return `/clientes/${m.clienteId}/pagos/${m.grupoId}`;
  return null;
}

/** Recurso cuyo permiso hace falta para abrir el comprobante de la operación. */
export const recursoComprobanteOperacion = (m: Pick<Movimiento, 'proveedorId'>): 'proveedores' | 'clientes' =>
  m.proveedorId ? 'proveedores' : 'clientes';

/** Cómo llamar a la operación de la que forma parte el movimiento. */
export function etiquetaOperacion(m: Pick<Movimiento, 'subtipo' | 'proveedorId'>): string {
  if (m.subtipo === 'pago' || m.subtipo === 'adelanto') return 'pago a proveedor';
  if (m.subtipo === 'cobro' || m.subtipo === 'anticipo') return 'cobro a cliente';
  return m.proveedorId ? 'pago o cruce con proveedor' : 'cobro o cruce con cliente';
}

/** Título del documento al compartir: el archivo queda como "Movimiento-N000123-<tercero o banca>.png". */
export function tituloCompartirMovimiento(m: Pick<Movimiento, 'subtipo' | 'numero'> & { numeroSistema?: number | null }, terceroOBanca: string | null): string {
  const numero = numeroMovimiento(m);
  return ['Movimiento', numero === SIN_NUMERO ? null : numero, terceroOBanca].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Transferencias con mesa de cambio
// ---------------------------------------------------------------------------

type CamposMesa = Pick<Movimiento, 'anulado' | 'mesaCambistaId' | 'mesaEstado'>;

/** Transferencia vigente con mesa de cambio con algo por cobrar: en proceso (nada recibido) o en cobro parcial. */
export const esTransferenciaEnProceso = (m: CamposMesa): boolean =>
  !m.anulado && m.mesaCambistaId != null && (m.mesaEstado === 'en_proceso' || m.mesaEstado === 'parcial');

/** "En proceso" / "Cobro parcial" / "Completada" para una transferencia con mesa; null si no aplica o está anulada (manda "Anulado"). */
export function etiquetaEstadoMesa(m: CamposMesa): 'En proceso' | 'Cobro parcial' | 'Completada' | null {
  if (m.anulado || m.mesaCambistaId == null) return null;
  if (m.mesaEstado === 'en_proceso') return 'En proceso';
  if (m.mesaEstado === 'parcial') return 'Cobro parcial';
  return m.mesaEstado === 'completada' ? 'Completada' : null;
}

const redondear2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const fmt2 = (n: number): string => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Lo que recibe (o recibirá) la cuenta destino: bruto menos comisión en proceso; lo acreditado si ya se completó. */
export function montoQueRecibeElDestino(
  m: Pick<Movimiento, 'mesaCambistaId' | 'mesaEstado' | 'mesaMontoBruto' | 'mesaComision' | 'montoDestino' | 'monto'>
): number | null {
  if (m.mesaCambistaId == null) return null;
  if (m.mesaEstado === 'completada') return m.montoDestino ?? m.monto;
  const bruto = m.mesaMontoBruto;
  return bruto == null ? null : redondear2(bruto - (m.mesaComision ?? 0));
}

/** "USD 20,00 (2%)", "USD 20,00 (monto manual)" o "Sin comisión". `simbolo` es el de la moneda de la cuenta destino. */
export function textoComisionMesa(
  m: Pick<Movimiento, 'mesaComision' | 'mesaComisionModo' | 'mesaComisionPct'>,
  simbolo: string
): string {
  if (!m.mesaComision || m.mesaComision <= 0) return 'Sin comisión';
  const detalle = m.mesaComisionModo === 'porcentaje' && m.mesaComisionPct != null
    ? `${m.mesaComisionPct.toLocaleString('es-VE', { maximumFractionDigits: 4 })}%`
    : 'monto manual';
  return `${simbolo} ${fmt2(m.mesaComision)} (${detalle})`;
}

/** ¿Es el movimiento principal de una comisión bancaria (lleva un cargo aparte en la misma cuenta)? */
export const tieneComision = (m: Pick<Movimiento, 'comisionBancaria'>): boolean => m.comisionBancaria != null;

/** ¿Es el cargo de la comisión bancaria de otro movimiento? Se anula junto con su movimiento, no por separado. */
export const esCargoDeComision = (m: Pick<Movimiento, 'comisionDeId'>): boolean => m.comisionDeId != null;

// ---------------------------------------------------------------------------
// Navegación entre movimientos (anterior / siguiente desde el detalle)
// ---------------------------------------------------------------------------

/** Movimientos del más antiguo al más reciente (fecha, luego hora de registro, luego id). No muta la entrada. */
export function ordenCronologico<T extends Pick<Movimiento, 'id' | 'fecha' | 'creadoEn'>>(movimientos: readonly T[]): T[] {
  return [...movimientos].sort((a, b) =>
    diaDe(a).localeCompare(diaDe(b)) || (a.creadoEn ?? '').localeCompare(b.creadoEn ?? '') || a.id.localeCompare(b.id));
}

export interface VecinosMovimiento {
  /** Movimiento anterior en el tiempo (más antiguo); null si es el primero. */
  anteriorId: string | null;
  /** Movimiento siguiente en el tiempo (más reciente); null si es el último. */
  siguienteId: string | null;
  /** Posición (desde 1) y total de la lista; null si el movimiento no está en ella. */
  posicion: number | null;
  total: number;
}

/** Vecinos de un movimiento dentro de una lista de ids ya ordenada cronológicamente. */
export function vecinosEnLista(ids: readonly string[], id: string): VecinosMovimiento {
  const i = ids.indexOf(id);
  if (i === -1) return { anteriorId: null, siguienteId: null, posicion: null, total: ids.length };
  return { anteriorId: i > 0 ? ids[i - 1] : null, siguienteId: i < ids.length - 1 ? ids[i + 1] : null, posicion: i + 1, total: ids.length };
}

/** Estado de navegación que lleva el enlace al detalle: la lista (filtrada) de la que viene la persona. */
export interface EstadoNavegacionMovimiento { navegacion: string[] }

/** Lee con seguridad la lista de ids que trae el estado del enrutador (cualquier otra cosa => null). */
export function idsDeNavegacion(estado: unknown): string[] | null {
  const lista = (estado as Partial<EstadoNavegacionMovimiento> | null)?.navegacion;
  return Array.isArray(lista) && lista.every(x => typeof x === 'string') ? lista : null;
}
