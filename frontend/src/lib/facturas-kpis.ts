/** Cálculos de las pantallas de facturas de compra y venta (lógica PURA, sin React; se prueba desde backend/tests).
 *  Reglas de negocio que respeta:
 *  - Solo cuentan como "facturado" las facturas emitidas o pagadas: una anulada no es deuda y un borrador no se emitió.
 *  - El sistema NO registra cobros de ventas (montoPagado siempre 0): jamás se calcula "cobrado" ni "por cobrar" real.
 *  - No existe fecha de vencimiento: la antigüedad se mide desde la fecha de emisión (createdAt), nunca se habla de "vencidas". */

import type { FacturaCV, TipoFactura } from '../services/factura-cv-service';
import { compararConPeriodoAnterior, type ComparacionPeriodo } from './comparacion';
import { saldoFactura, tieneSaldoPendiente } from './estado-factura';
import { diaNegocio } from './fecha-negocio';

export type EstadoFactura = FacturaCV['estado'];

export const ESTADOS_FACTURA: readonly EstadoFactura[] = ['emitida', 'pendiente', 'pagada', 'borrador', 'anulada'];

const MS_DIA = 86_400_000;
/** Mínimo de semanas con datos para que valga la pena una gráfica de barras por semana. */
export const MIN_SEMANAS_GRAFICA = 2;
/** Mínimo de proveedores/clientes distintos para un ranking en barras (con menos se muestra solo texto). */
export const MIN_ENTIDADES_RANKING = 3;
/** Mínimo de estados distintos para la dona por estado. */
export const MIN_ESTADOS_DONA = 2;
/** Días de antigüedad desde la emisión a partir de los cuales una factura de compra con saldo pide atención / es urgente. */
export const DIAS_ATENCION_SALDO = 15;
export const DIAS_URGENTE_SALDO = 30;
/** Periodo por defecto de la pantalla cuando no hay rango en la URL ni búsqueda por código. */
export const DIAS_PERIODO_POR_DEFECTO = 30;

const esIso = (v: string | undefined): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const aMs = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
const aIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Fecha de emisión "AAAA-MM-DD" de una factura. */
export function fechaEmision(f: Pick<FacturaCV, 'createdAt'>): string {
  return diaNegocio(f.createdAt) ?? f.createdAt.slice(0, 10);
}

/** Una factura cuenta como facturada si está emitida, pendiente (pago parcial) o pagada. */
export function cuentaComoFacturada(f: Pick<FacturaCV, 'estado'>): boolean {
  return tieneSaldoPendiente(f.estado) || f.estado === 'pagada';
}

export function pesoFactura(f: Pick<FacturaCV, 'items'>): number {
  return f.items.reduce((acc, it) => acc + (Number.isFinite(it.peso) ? it.peso : 0), 0);
}

/** Saldo pendiente de una factura: solo las emitidas y pendientes tienen saldo (pagada = 0, anulada/borrador no son deuda). */
export function saldoCompra(f: Pick<FacturaCV, 'estado' | 'total' | 'montoPagado'>): number {
  if (!tieneSaldoPendiente(f.estado)) return 0;
  return saldoFactura(f);
}

// ---------------------------------------------------------------- resumen del periodo

export interface ResumenFacturas {
  /** Todas las facturas recibidas (cualquier estado). */
  cantidad: number;
  /** Emitidas + pendientes + pagadas. */
  facturadas: number;
  /** Suma del total de las facturadas. */
  total: number;
  /** Kg de las facturadas. */
  kg: number;
  /** Compras: suma de lo pagado en las facturadas. En ventas siempre 0 (no hay registro de cobros). */
  pagado: number;
  /** Compras: saldo de las emitidas. En ventas no aplica (0). */
  pendiente: number;
  /** Ventas: total de las emitidas (sin registro de cobros). En compras es el de las emitidas también. */
  totalEmitidas: number;
  porEstado: Record<EstadoFactura, { cantidad: number; total: number }>;
}

export function resumirFacturas(facturas: readonly FacturaCV[], tipo: TipoFactura): ResumenFacturas {
  const r: ResumenFacturas = {
    cantidad: facturas.length, facturadas: 0, total: 0, kg: 0, pagado: 0, pendiente: 0, totalEmitidas: 0,
    porEstado: { emitida: { cantidad: 0, total: 0 }, pendiente: { cantidad: 0, total: 0 }, pagada: { cantidad: 0, total: 0 }, borrador: { cantidad: 0, total: 0 }, anulada: { cantidad: 0, total: 0 } },
  };
  for (const f of facturas) {
    const grupo = r.porEstado[f.estado] ?? r.porEstado.emitida;
    grupo.cantidad += 1;
    grupo.total += f.total;
    if (!cuentaComoFacturada(f)) continue;
    r.facturadas += 1;
    r.total += f.total;
    r.kg += pesoFactura(f);
    if (tieneSaldoPendiente(f.estado)) r.totalEmitidas += f.total;
    if (tipo === 'compra') {
      r.pagado += f.montoPagado;
      r.pendiente += saldoCompra(f);
    }
  }
  return r;
}

/** "13 pagadas, 4 emitidas": desglose por estado en palabras (solo los estados con facturas). */
export function textoDesglosePorEstado(r: ResumenFacturas): string {
  const nombres: Record<EstadoFactura, [string, string]> = {
    emitida: ['emitida', 'emitidas'], pendiente: ['pendiente', 'pendientes'], pagada: ['pagada', 'pagadas'], borrador: ['borrador', 'borradores'], anulada: ['anulada', 'anuladas'],
  };
  const partes = (['pagada', 'pendiente', 'emitida', 'borrador', 'anulada'] as const)
    .filter(e => r.porEstado[e].cantidad > 0)
    .map(e => `${r.porEstado[e].cantidad} ${nombres[e][r.porEstado[e].cantidad === 1 ? 0 : 1]}`);
  return partes.join(', ');
}

// ---------------------------------------------------------------- periodos

export interface PeriodoEfectivo {
  desde?: string;
  hasta?: string;
  /** 'url' = lo eligió el usuario; 'defecto' = últimos 30 días; 'todo' = sin rango (búsqueda por código). */
  origen: 'url' | 'defecto' | 'todo';
}

/** Rango que usa la pantalla: el de la URL si viene completo; si no, la búsqueda por código mira TODO el historial
 *  (un código se debe encontrar aunque sea viejo) y, sin búsqueda, los últimos 30 días. `hoy` = "AAAA-MM-DD". */
export function periodoEfectivo(desde: string | undefined, hasta: string | undefined, hayBusqueda: boolean, hoy: string): PeriodoEfectivo {
  if (esIso(desde) && esIso(hasta) && desde <= hasta) return { desde, hasta, origen: 'url' };
  if (hayBusqueda) return { origen: 'todo' };
  const ini = aIso(aMs(hoy) - (DIAS_PERIODO_POR_DEFECTO - 1) * MS_DIA);
  return { desde: ini, hasta: hoy, origen: 'defecto' };
}

/** Periodo inmediatamente anterior y de la misma duración. null si el rango no es válido. */
export function periodoAnterior(desde: string | undefined, hasta: string | undefined): { desde: string; hasta: string } | null {
  if (!esIso(desde) || !esIso(hasta) || desde > hasta) return null;
  const dias = Math.round((aMs(hasta) - aMs(desde)) / MS_DIA) + 1;
  const hastaAnt = aMs(desde) - MS_DIA;
  return { desde: aIso(hastaAnt - (dias - 1) * MS_DIA), hasta: aIso(hastaAnt) };
}

/** Compara el total facturado con el del periodo anterior. Sin facturas facturadas en el anterior: null ("sin historial
 *  comparable"; nunca un +100 % engañoso). En compras el tono es siempre neutro (gastar más no es "bueno" ni "malo"). */
export function compararTotalFacturado(actual: ResumenFacturas, anterior: ResumenFacturas | null, tipo: TipoFactura): ComparacionPeriodo | null {
  if (!anterior || anterior.facturadas === 0) return null;
  const cmp = compararConPeriodoAnterior(actual.total, anterior.total, 'sube');
  if (!cmp) return null;
  return tipo === 'compra' ? { ...cmp, tono: 'neutro' } : cmp;
}

// ---------------------------------------------------------------- gráficas

/** Lunes de la semana de una fecha ISO. */
export function inicioDeSemana(iso: string): string {
  const ms = aMs(iso);
  const dia = new Date(ms).getUTCDay(); // 0 = domingo
  return aIso(ms - ((dia + 6) % 7) * MS_DIA);
}

export interface SemanaTotal { inicio: string; total: number; cantidad: number }

/** Total facturado por semana (lunes a domingo), con las semanas sin facturas en cero para que el eje sea continuo. */
export function totalesPorSemana(facturas: readonly FacturaCV[]): SemanaTotal[] {
  const mapa = new Map<string, SemanaTotal>();
  for (const f of facturas) {
    if (!cuentaComoFacturada(f)) continue;
    const inicio = inicioDeSemana(fechaEmision(f));
    const s = mapa.get(inicio) ?? { inicio, total: 0, cantidad: 0 };
    s.total += f.total;
    s.cantidad += 1;
    mapa.set(inicio, s);
  }
  const claves = [...mapa.keys()].sort();
  if (claves.length === 0) return [];
  const salida: SemanaTotal[] = [];
  for (let ms = aMs(claves[0]); ms <= aMs(claves[claves.length - 1]); ms += 7 * MS_DIA) {
    const k = aIso(ms);
    salida.push(mapa.get(k) ?? { inicio: k, total: 0, cantidad: 0 });
  }
  return salida;
}

/** La gráfica semanal solo se dibuja con al menos 2 semanas distintas con facturas. */
export function haySuficientesSemanas(semanas: readonly SemanaTotal[]): boolean {
  return semanas.filter(s => s.cantidad > 0).length >= MIN_SEMANAS_GRAFICA;
}

export interface TopEntidad { clave: string; nombre: string; total: number; cantidad: number }

/** Ranking de proveedores/clientes por monto facturado (mayor primero; desempate por nombre). */
export function topEntidades(facturas: readonly FacturaCV[]): TopEntidad[] {
  const mapa = new Map<string, TopEntidad>();
  for (const f of facturas) {
    if (!cuentaComoFacturada(f)) continue;
    const nombre = f.nombreEntidad ?? 'Sin nombre';
    const clave = f.entidadId ?? `nombre:${nombre}`;
    const e = mapa.get(clave) ?? { clave, nombre, total: 0, cantidad: 0 };
    e.total += f.total;
    e.cantidad += 1;
    mapa.set(clave, e);
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'));
}

export interface ParteEstado { estado: EstadoFactura; cantidad: number }

/** Cantidad de facturas por estado (solo los que tienen facturas): como máximo 4 partes. */
export function partesPorEstado(facturas: readonly FacturaCV[]): ParteEstado[] {
  return ESTADOS_FACTURA
    .map(estado => ({ estado, cantidad: facturas.filter(f => f.estado === estado).length }))
    .filter(p => p.cantidad > 0);
}

// ---------------------------------------------------------------- antigüedad de facturas emitidas con saldo

export interface FacturaConSaldo { id: string; codigo: string | null; entidad: string; dias: number; saldo: number }

export interface TramoAntiguedad { etiqueta: string; desdeDias: number; hastaDias: number | null; cantidad: number; monto: number }

export interface AntiguedadSaldos {
  facturas: FacturaConSaldo[];
  tramos: TramoAntiguedad[];
  totalSaldo: number;
  diasMasAntigua: number;
  /** La más antigua (para enlazar). */
  masAntigua: FacturaConSaldo | null;
}

/** Días enteros entre dos fechas ISO (nunca negativo). */
export function diasEntre(desdeIso: string, hastaIso: string): number {
  return Math.max(0, Math.round((aMs(hastaIso) - aMs(desdeIso)) / MS_DIA));
}

const TRAMOS: ReadonlyArray<{ etiqueta: string; desde: number; hasta: number | null }> = [
  { etiqueta: '0 a 7 días', desde: 0, hasta: 7 },
  { etiqueta: '8 a 15 días', desde: 8, hasta: 15 },
  { etiqueta: '16 a 30 días', desde: 16, hasta: 30 },
  { etiqueta: 'Más de 30 días', desde: 31, hasta: null },
];

/** Antigüedad (desde la emisión) de las facturas emitidas y pendientes con saldo. El saldo es total − aplicado
 *  (en ventas sin cobros aplicados coincide con el total emitido). */
export function antiguedadSaldos(facturas: readonly FacturaCV[], _tipo: TipoFactura, hoy: string): AntiguedadSaldos {
  const lista: FacturaConSaldo[] = [];
  for (const f of facturas) {
    if (!tieneSaldoPendiente(f.estado)) continue;
    // Ya filtradas por estado con saldo: el saldo real (total menos lo aplicado) vale en compras y en ventas pendientes.
    const saldo = saldoFactura(f);
    if (!(saldo > 0)) continue;
    lista.push({ id: f.id, codigo: f.codigo, entidad: f.nombreEntidad ?? 'Sin nombre', dias: diasEntre(fechaEmision(f), hoy), saldo });
  }
  lista.sort((a, b) => b.dias - a.dias || b.saldo - a.saldo);
  const tramos: TramoAntiguedad[] = TRAMOS.map(t => {
    const dentro = lista.filter(x => x.dias >= t.desde && (t.hasta === null || x.dias <= t.hasta));
    return { etiqueta: t.etiqueta, desdeDias: t.desde, hastaDias: t.hasta, cantidad: dentro.length, monto: dentro.reduce((s, x) => s + x.saldo, 0) };
  });
  return {
    facturas: lista,
    tramos,
    totalSaldo: lista.reduce((s, x) => s + x.saldo, 0),
    diasMasAntigua: lista[0]?.dias ?? 0,
    masAntigua: lista[0] ?? null,
  };
}

/** Severidad de la alerta de antigüedad. Ventas siempre 'info' (no hay cobros registrados: no se sabe si algo está pendiente).
 *  Compras: más de 30 días desde la emisión = roja; más de 15 = amarilla; si no, info. */
export function severidadAntiguedad(tipo: TipoFactura, diasMasAntigua: number): 'roja' | 'amarilla' | 'info' {
  if (tipo === 'venta') return 'info';
  if (diasMasAntigua > DIAS_URGENTE_SALDO) return 'roja';
  if (diasMasAntigua > DIAS_ATENCION_SALDO) return 'amarilla';
  return 'info';
}

/** Cuánto va pagado de una factura de compra, en % acotado a 0-100 (0 si el total no es positivo). */
export function porcentajePagado(total: number, montoPagado: number): number {
  if (!(total > 0) || !Number.isFinite(montoPagado)) return 0;
  return Math.min(100, Math.max(0, (montoPagado / total) * 100));
}

/** Porcentaje entero para mostrar: nunca redondea hacia arriba hasta 100 si todavía queda saldo (99,97 se muestra 99). */
export function porcentajeEntero(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return pct >= 100 ? 100 : Math.floor(pct);
}
