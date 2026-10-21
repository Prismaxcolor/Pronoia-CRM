import type { RespuestaSaldos, SaldoEntidad, TotalesSaldos } from '../../../shared/types/saldos.js';
import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { leerPaginado } from '../utils/paginacion.js';
import { crearCacheCorto } from '../utils/cache-corto.js';
import { conLimiteDeTiempo } from '../utils/tiempo-limite.js';
import {
  agruparPagos,
  construirEstadoCuenta,
  type PagoCrudo,
  type TipoEntidad,
} from './estado-cuenta-service.js';

/**
 * Saldo de TODAS las proveedores/clientes en pocas consultas (pantallas de Proveedores y Clientes).
 * La cifra sale de construirEstadoCuenta (la misma función del estado de cuenta), así que no puede
 * divergir de `totales.saldo` de GET /:id/estado-cuenta.
 */

export const TTL_CACHE_SALDOS_MS = 20_000;
export const PRESUPUESTO_SALDOS_MS = 8_000;
const MS_POR_DIA = 86_400_000;
/** Por debajo de esto una factura se considera saldada (igual que cruce-service / aplicar_item_cruce). */
const PENDIENTE_MINIMO = 0.01;
const ESTADOS_SIN_DEUDA = new Set(['anulada', 'borrador', 'pagada']);

export class ErrorSaldos extends Error {
  constructor(readonly codigo: 'tiempo' | 'lectura', mensaje: string) {
    super(mensaje);
    this.name = 'ErrorSaldos';
  }
}

// ---- núcleo puro ------------------------------------------------------------

export interface EntidadSaldo { id: string; nombre: string; activo: boolean }
export interface FacturaSaldo { entidadId: string; id: string; total: number; montoPagado: number | null; estado: string | null; fecha: string }
export interface PagoSaldo {
  entidadId: string; id: string; monto: number; montoUsd: number | null; fecha: string;
  subtipo: 'pago' | 'adelanto' | 'cobro' | 'anticipo' | null; grupoId: string | null;
}
export interface NotaSaldo { entidadId: string; id: string; tipo: 'credito' | 'debito'; monto: number; anulada: boolean; pagada: boolean; fecha: string }
export interface DatosSaldos {
  facturas: FacturaSaldo[];
  pagos: PagoSaldo[];
  notas: NotaSaldo[];
  /** Monto aplicado de cada adelanto (pago_aplicaciones tipo 'adelanto'), por item_id. */
  aplicadoPorAdelanto: Map<string, number>;
}

const redondear = (n: number): number => Math.round(n * 100) / 100;

function agrupar<T extends { entidadId: string }>(filas: readonly T[]): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const f of filas) {
    const lista = mapa.get(f.entidadId);
    if (lista) lista.push(f);
    else mapa.set(f.entidadId, [f]);
  }
  return mapa;
}

function diasDesde(fecha: string, ahora: Date): number {
  return Math.max(0, Math.floor((ahora.getTime() - new Date(fecha).getTime()) / MS_POR_DIA));
}

function calcularTotales(tipo: TipoEntidad, saldos: SaldoEntidad[]): TotalesSaldos {
  const porSaldar = redondear(saldos.reduce((s, x) => s + Math.max(x.saldo, 0), 0));
  return {
    facturado: redondear(saldos.reduce((s, x) => s + x.facturado, 0)),
    pagado: redondear(saldos.reduce((s, x) => s + x.pagado, 0)),
    saldo: redondear(saldos.reduce((s, x) => s + x.saldo, 0)),
    ...(tipo === 'proveedor' ? { porPagar: porSaldar } : { porCobrar: porSaldar }),
    aFavor: redondear(saldos.reduce((s, x) => s + Math.max(-x.saldo, 0), 0)),
  };
}

function saldoDeEntidad(
  tipo: TipoEntidad,
  entidad: EntidadSaldo,
  facturas: FacturaSaldo[],
  pagos: PagoSaldo[],
  notas: NotaSaldo[],
  aplicadoPorAdelanto: Map<string, number>,
  ahora: Date
): SaldoEntidad {
  const pagosCrudos: PagoCrudo[] = pagos.map(p => ({
    id: p.id, monto: Number(p.montoUsd ?? p.monto), descripcion: null, referencia: null,
    fecha: p.fecha, subtipo: p.subtipo, grupoId: p.grupoId,
  }));
  const estado = construirEstadoCuenta(
    { id: entidad.id, tipo, nombre: entidad.nombre },
    facturas.map(f => ({ id: f.id, total: f.total, descripcion: null, fecha: f.fecha })),
    agruparPagos(pagosCrudos),
    notas.map(n => ({ id: n.id, tipo: n.tipo, monto: Number(n.monto), motivo: '', anulada: n.anulada, pagada: n.pagada, fecha: n.fecha })),
    { cruces: [], adelantoAplicadoPorId: aplicadoPorAdelanto }
  );

  const pendientes = facturas.filter(
    f => !ESTADOS_SIN_DEUDA.has(f.estado ?? '') && Number(f.total) - Number(f.montoPagado ?? 0) > PENDIENTE_MINIMO
  );
  const masVieja = pendientes.reduce<string | null>((min, f) => (min === null || f.fecha < min ? f.fecha : min), null);
  const ultima = estado.entradas.filter(e => !e.anulada).reduce<string | null>((max, e) => (max === null || e.fecha > max ? e.fecha : max), null);

  return {
    entidadId: entidad.id,
    nombre: entidad.nombre,
    activo: entidad.activo,
    facturado: redondear(estado.totales.facturado),
    pagado: redondear(estado.totales.pagado),
    saldo: redondear(estado.totales.saldo),
    adelantoDisponible: redondear(estado.entradas.reduce((s, e) => s + (e.tipo === 'adelanto' ? e.adelantoDisponible ?? 0 : 0), 0)),
    notasCreditoDisponibles: redondear(notas.filter(n => n.tipo === 'credito' && !n.anulada && !n.pagada).reduce((s, n) => s + Number(n.monto), 0)),
    ultimaOperacion: ultima,
    cantidadFacturasPendientes: pendientes.length,
    antiguedadMasVieja: masVieja === null ? null : diasDesde(masVieja, ahora),
  };
}

/** Función pura: agrupa en memoria por entidad y reutiliza construirEstadoCuenta para cada una. */
export function calcularSaldos(
  tipo: TipoEntidad,
  entidades: readonly EntidadSaldo[],
  datos: DatosSaldos,
  ahora: Date = new Date()
): RespuestaSaldos {
  const facturas = agrupar(datos.facturas);
  const pagos = agrupar(datos.pagos);
  const notas = agrupar(datos.notas);
  const saldos = entidades.map(e =>
    saldoDeEntidad(tipo, e, facturas.get(e.id) ?? [], pagos.get(e.id) ?? [], notas.get(e.id) ?? [], datos.aplicadoPorAdelanto, ahora)
  );
  return { tipo, saldos, totales: calcularTotales(tipo, saldos), calculadoEn: ahora.toISOString() };
}

// ---- acceso a datos ----------------------------------------------------------

interface Tablas { entidad: string; facturas: string; notas: string; columna: 'proveedor_id' | 'cliente_id'; tipoMov: 'egreso' | 'ingreso' }

function tablasDe(tipo: TipoEntidad): Tablas {
  return tipo === 'proveedor'
    ? { entidad: 'proveedores', facturas: 'facturas_compra', notas: 'notas_ajuste_proveedor', columna: 'proveedor_id', tipoMov: 'egreso' }
    : { entidad: 'clientes', facturas: 'facturas_venta', notas: 'notas_ajuste_cliente', columna: 'cliente_id', tipoMov: 'ingreso' };
}

type Fila = Record<string, unknown>;

async function leerTabla(tabla: string, columnas: string, filtrar: (q: ReturnType<typeof inicio>) => ReturnType<typeof inicio> = q => q): Promise<Fila[]> {
  function inicio() { return supabaseAdmin.from(tabla).select(columnas); }
  return leerPaginado<Fila>((desde, hasta) => filtrar(inicio()).order('id', { ascending: true }).range(desde, hasta));
}

/** Lee entidades, facturas, movimientos, notas y aplicaciones UNA vez (paginado) y devuelve los datos crudos. */
export async function cargarDatosSaldos(tipo: TipoEntidad): Promise<DatosSaldos & { entidades: EntidadSaldo[] }> {
  const t = tablasDe(tipo);
  const col = t.columna;
  const [entidades, facturas, movs, notas, aplicaciones] = await Promise.all([
    leerTabla(t.entidad, 'id, nombre, activo'),
    // Igual que el estado de cuenta: las facturas anuladas no son deuda.
    leerTabla(t.facturas, `id, ${col}, total, monto_pagado, estado, created_at`, q => q.neq('estado', 'anulada')),
    leerTabla('movimientos', `id, ${col}, monto, monto_usd, fecha, subtipo, grupo_id`, q => q.eq('tipo', t.tipoMov).eq('anulado', false)),
    leerTabla(t.notas, `id, ${col}, tipo, monto, anulada, pagada, fecha`),
    leerTabla('pago_aplicaciones', 'id, item_id, monto_usd', q => q.eq('tipo', 'adelanto').eq('anulada', false)),
  ]);

  const aplicadoPorAdelanto = new Map<string, number>();
  for (const a of aplicaciones) {
    const k = String(a.item_id);
    aplicadoPorAdelanto.set(k, (aplicadoPorAdelanto.get(k) ?? 0) + Number(a.monto_usd));
  }

  return {
    entidades: entidades.map(e => ({ id: String(e.id), nombre: String(e.nombre), activo: e.activo !== false })),
    facturas: facturas.filter(f => f[col] != null).map(f => ({
      entidadId: String(f[col]), id: String(f.id), total: Number(f.total),
      montoPagado: f.monto_pagado == null ? null : Number(f.monto_pagado),
      estado: (f.estado as string | null) ?? null, fecha: String(f.created_at),
    })),
    pagos: movs.filter(m => m[col] != null).map(m => ({
      entidadId: String(m[col]), id: String(m.id), monto: Number(m.monto),
      montoUsd: m.monto_usd == null ? null : Number(m.monto_usd),
      fecha: String(m.fecha), subtipo: (m.subtipo as PagoSaldo['subtipo']) ?? null, grupoId: (m.grupo_id as string | null) ?? null,
    })),
    notas: notas.filter(n => n[col] != null).map(n => ({
      entidadId: String(n[col]), id: String(n.id), tipo: n.tipo as 'credito' | 'debito', monto: Number(n.monto),
      anulada: Boolean(n.anulada), pagada: Boolean(n.pagada), fecha: String(n.fecha),
    })),
    aplicadoPorAdelanto,
  };
}

export interface OpcionesSaldos { ahora?: Date; presupuestoMs?: number }

async function calcularConPresupuesto(tipo: TipoEntidad, opts: OpcionesSaldos): Promise<RespuestaSaldos> {
  const inicio = Date.now();
  const r = await conLimiteDeTiempo(cargarDatosSaldos(tipo), opts.presupuestoMs ?? PRESUPUESTO_SALDOS_MS);
  if (!r.ok) {
    if (r.motivo === 'tiempo') {
      logger.warn({ evento: 'saldos.tiempo_agotado', tipo, ms: Date.now() - inicio });
      throw new ErrorSaldos('tiempo', 'Tiempo agotado al calcular los saldos.');
    }
    logger.error({ evento: 'saldos.lectura_fallida', tipo, error: r.error instanceof Error ? r.error.message : String(r.error) });
    throw new ErrorSaldos('lectura', 'No se pudieron leer los datos para calcular los saldos.');
  }
  const { entidades, ...datos } = r.valor;
  return calcularSaldos(tipo, entidades, datos, opts.ahora ?? new Date());
}

const caches = {
  proveedor: crearCacheCorto<RespuestaSaldos>({ ttlMs: TTL_CACHE_SALDOS_MS, maxEntradas: 1 }),
  cliente: crearCacheCorto<RespuestaSaldos>({ ttlMs: TTL_CACHE_SALDOS_MS, maxEntradas: 1 }),
};

/** Saldos de todas las entidades del tipo, con caché de ~20 s. Lanza ErrorSaldos si no se pueden calcular completos. */
export function obtenerSaldos(tipo: TipoEntidad, opts: OpcionesSaldos = {}): Promise<RespuestaSaldos> {
  return caches[tipo].obtener(tipo, () => calcularConPresupuesto(tipo, opts));
}

/** Vacía ambas cachés: llamar tras escrituras que cambian facturas, pagos, cobros, notas o cruces. */
export function invalidarCacheSaldos(): void {
  caches.proveedor.invalidar();
  caches.cliente.invalidar();
}
