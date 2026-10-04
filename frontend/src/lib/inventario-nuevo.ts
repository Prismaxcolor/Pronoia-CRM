/** Lógica pura (sin React) de la pantalla nueva de inventario: formateo es-VE con unidad, cálculo de
 *  faltantes del contenedor, comparación contra el periodo anterior y estado de filtros <-> URL. */

import type { ResumenInventario } from '../services/inventario-resumen-service';

// ---------------------------------------------------------------- formateo
// La implementación vive en lib/formato.ts (formato es-VE unificado); se re-exporta aquí para no romper importadores.
import { esFechaIso } from './formato';
export { formatearNumero, formatearKg, formatearUsd, formatearPct, esFechaIso } from './formato';

// ---------------------------------------------------------------- contenedor

export const META_CONTENEDOR_POR_DEFECTO_KG = 18000;

/** Kilos que faltan para la meta (nunca negativo). */
export function calcularFaltanKg(metaKg: number, listoKg: number): number {
  if (!(metaKg > 0)) return 0;
  return Math.max(0, metaKg - Math.max(0, listoKg));
}

/** Progreso 0-100 (acotado). Con meta inválida devuelve 0. */
export function calcularProgresoPct(metaKg: number, listoKg: number): number {
  if (!(metaKg > 0)) return 0;
  return Math.min(100, Math.max(0, (listoKg / metaKg) * 100));
}

// ---------------------------------------------------------------- comparación vs periodo anterior
// La implementación vive en lib/comparacion.ts; se re-exporta aquí.
export { compararConPeriodoAnterior } from './comparacion';
export type { ComparacionPeriodo, MejorCuando, TonoComparacion } from './comparacion';

// ---------------------------------------------------------------- KPIs derivados del resumen

export interface KpisInventario {
  valor: {
    oculto: boolean;
    costoUsd: number | null;
    kgConCosto: number;
    kgSinCosto: number;
    ventaEstimadaUsd: number | null;
    kgConPrecio: number;
    kgSinPrecio: number;
  };
  galpon: { totalKg: number; almacenes: Array<{ nombre: string; totalKg: number }> };
  listos: { kg: number };
  merma: {
    pct: number;
    kgMerma: number;
    umbralPct: number;
    sobreUmbral: boolean;
    /** null si el periodo anterior no tuvo transformaciones (no hay con qué comparar). */
    pctAnterior: number | null;
    sinClasificarKg: number;
    porTipo: Array<{ tipo: string; kg: number }>;
    transformaciones: number;
  };
}

export function derivarKpis(r: ResumenInventario): KpisInventario {
  const oculto = r.valorOculto || r.valor == null;
  const m = r.merma;
  return {
    valor: {
      oculto,
      costoUsd: oculto ? null : r.valor!.costoMateriales.valorUsd,
      kgConCosto: oculto ? 0 : r.valor!.costoMateriales.kgConCosto,
      kgSinCosto: oculto ? 0 : r.valor!.costoMateriales.kgSinCosto,
      ventaEstimadaUsd: oculto ? null : r.valor!.ventaEstimadaLotes.valorUsd,
      kgConPrecio: oculto ? 0 : r.valor!.ventaEstimadaLotes.kgConPrecio,
      kgSinPrecio: oculto ? 0 : r.valor!.ventaEstimadaLotes.kgSinPrecio,
    },
    galpon: {
      totalKg: r.totalKg,
      almacenes: r.almacenes.filter(a => a.activo || a.totalKg !== 0).map(a => ({ nombre: a.nombre, totalKg: a.totalKg })),
    },
    // TODO(listos): sumar el stock de venta directa disponible cuando el resumen lo entregue (hoy solo trae
    // exportacion.listoKg = embalados vigentes de lotes de exportación). No se estima nada por nuestra cuenta.
    listos: { kg: r.exportacion.listoKg },
    merma: {
      pct: m.actual.pctMerma,
      kgMerma: m.actual.kgMerma,
      umbralPct: m.umbralPct,
      sobreUmbral: m.sobreUmbral,
      pctAnterior: m.anterior.kgEntrada > 0 ? m.anterior.pctMerma : null,
      sinClasificarKg: m.actual.sinClasificar.kg,
      porTipo: m.actual.tipos.map(t => ({ tipo: t.tipo, kg: t.kg })),
      transformaciones: m.actual.transformaciones,
    },
  };
}

// ---------------------------------------------------------------- filtros <-> URL

export const ETAPAS = ['materia_prima', 'en_proceso', 'listo'] as const;
export type EtapaFiltro = (typeof ETAPAS)[number];

/** Vistas del selector segmentado (?vista=). 'otras' solo aparece si hay algo que no encaja en las tres principales. */
export const VISTAS_URL = ['exportacion', 'venta_nacional', 'trabajo_interno', 'otras'] as const;
export type VistaUrl = (typeof VISTAS_URL)[number];
export const VISTA_POR_DEFECTO: VistaUrl = 'exportacion';

export interface FiltrosPantalla {
  desde?: string;
  hasta?: string;
  categoria?: string;
  q?: string;
  almacen?: string;
  proveedor?: string;
  etapa?: EtapaFiltro;
  lote?: string;
  /** Vista del selector segmentado. Sin valor equivale a 'exportacion'. */
  vista?: VistaUrl;
  /** '1' = la tabla muestra también las clasificaciones de compra PCB sin lote. */
  clasificaciones?: '1';
}

export const CLAVES_FILTRO = ['desde', 'hasta', 'categoria', 'q', 'almacen', 'proveedor', 'etapa', 'lote', 'vista', 'clasificaciones'] as const;
/** Filtros que viven en "Más filtros" (el resto son los 3 visibles: fechas, categoría, buscador). */
export const CLAVES_FILTRO_AVANZADO = ['almacen', 'proveedor', 'etapa', 'lote'] as const;

/** Lee los filtros de la URL. Descarta valores inválidos (fecha mal formada, rango invertido, etapa desconocida). */
export function filtrosDesdeUrl(params: URLSearchParams): FiltrosPantalla {
  const limpio = (k: string) => {
    const v = params.get(k)?.trim();
    return v ? v : undefined;
  };
  let desde = esFechaIso(params.get('desde')) ? params.get('desde')! : undefined;
  let hasta = esFechaIso(params.get('hasta')) ? params.get('hasta')! : undefined;
  if (!desde || !hasta || desde > hasta) { desde = undefined; hasta = undefined; }
  const etapa = params.get('etapa');
  const vista = params.get('vista');
  return {
    vista: (VISTAS_URL as readonly string[]).includes(vista ?? '') ? (vista as VistaUrl) : undefined,
    clasificaciones: params.get('clasificaciones') === '1' ? '1' : undefined,
    desde,
    hasta,
    categoria: limpio('categoria'),
    q: limpio('q'),
    almacen: limpio('almacen'),
    proveedor: limpio('proveedor'),
    etapa: (ETAPAS as readonly string[]).includes(etapa ?? '') ? (etapa as EtapaFiltro) : undefined,
    lote: limpio('lote'),
  };
}

/** Serializa a query (solo claves con valor, en orden fijo para URLs estables). */
export function filtrosAUrl(f: FiltrosPantalla): URLSearchParams {
  const p = new URLSearchParams();
  for (const k of CLAVES_FILTRO) {
    const v = f[k];
    if (v) p.set(k, v);
  }
  return p;
}

export function contarFiltrosAvanzados(f: FiltrosPantalla): number {
  return CLAVES_FILTRO_AVANZADO.filter(k => Boolean(f[k])).length;
}

/** Parámetros para /api/inventario/resumen: el endpoint exige desde y hasta juntos. */
export function parametrosResumen(f: FiltrosPantalla): { desde?: string; hasta?: string } {
  return f.desde && f.hasta ? { desde: f.desde, hasta: f.hasta } : {};
}

// ---------------------------------------------------------------- atajos de fechas
// La implementación vive en lib/rango-fechas.ts; se re-exporta aquí.
export { INICIO_HISTORICO, atajoActivo, rangoDeAtajo } from './rango-fechas';
export type { AtajoRango } from './rango-fechas';
