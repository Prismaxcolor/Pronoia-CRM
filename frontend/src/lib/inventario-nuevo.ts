/** Lógica pura (sin React) de la pantalla nueva de inventario: formateo es-VE con unidad, cálculo de
 *  faltantes del contenedor, comparación contra el periodo anterior y estado de filtros <-> URL. */

import type { ResumenInventario } from '../services/inventario-resumen-service';

// ---------------------------------------------------------------- formateo

/** Separador de miles "." y decimal "," (es-VE). Manual a propósito: Intl en es omite el separador en 4 cifras. */
export function formatearNumero(n: number, decimales = 0): string {
  if (!Number.isFinite(n)) return '—';
  const factor = 10 ** decimales;
  const redondeado = Math.round((Math.abs(n) + Number.EPSILON) * factor) / factor;
  const [entera, dec] = redondeado.toFixed(decimales).split('.');
  const conMiles = entera.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const signo = n < 0 && redondeado !== 0 ? '-' : '';
  return `${signo}${conMiles}${dec ? `,${dec}` : ''}`;
}

export const formatearKg = (n: number): string => `${formatearNumero(n, 0)} kg`;
export const formatearUsd = (n: number): string => `USD ${formatearNumero(n, 0)}`;
export const formatearPct = (n: number, decimales = 1): string => `${formatearNumero(n, decimales)} %`;

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

export type TonoComparacion = 'bueno' | 'malo' | 'neutro';
export type MejorCuando = 'sube' | 'baja';

export interface ComparacionPeriodo {
  direccion: 'sube' | 'baja' | 'igual';
  delta: number;
  /** null si el periodo anterior era 0 (no se puede dividir). */
  deltaPct: number | null;
  tono: TonoComparacion;
}

const EPS_IGUAL = 1e-9;

/** Compara el valor actual con el del periodo anterior. Sin dato anterior (null/undefined/NaN) devuelve null:
 *  la pantalla muestra "—" y no inventa nada. */
export function compararConPeriodoAnterior(
  actual: number,
  anterior: number | null | undefined,
  mejorCuando: MejorCuando,
): ComparacionPeriodo | null {
  if (anterior == null || !Number.isFinite(anterior) || !Number.isFinite(actual)) return null;
  const delta = actual - anterior;
  if (Math.abs(delta) < EPS_IGUAL) return { direccion: 'igual', delta: 0, deltaPct: anterior === 0 ? null : 0, tono: 'neutro' };
  const direccion = delta > 0 ? 'sube' : 'baja';
  const deltaPct = anterior === 0 ? null : (delta / Math.abs(anterior)) * 100;
  const esBueno = (direccion === 'sube') === (mejorCuando === 'sube');
  return { direccion, delta, deltaPct, tono: esBueno ? 'bueno' : 'malo' };
}

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

export interface FiltrosPantalla {
  desde?: string;
  hasta?: string;
  categoria?: string;
  q?: string;
  almacen?: string;
  proveedor?: string;
  etapa?: EtapaFiltro;
  lote?: string;
}

export const CLAVES_FILTRO = ['desde', 'hasta', 'categoria', 'q', 'almacen', 'proveedor', 'etapa', 'lote'] as const;
/** Filtros que viven en "Más filtros" (el resto son los 3 visibles: fechas, categoría, buscador). */
export const CLAVES_FILTRO_AVANZADO = ['almacen', 'proveedor', 'etapa', 'lote'] as const;

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export function esFechaIso(valor: string | null | undefined): valor is string {
  if (!valor || !FECHA_RE.test(valor)) return false;
  const d = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor;
}

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
  return {
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

export type AtajoRango = '7d' | '30d' | 'mes' | 'todo';
export const INICIO_HISTORICO = '2020-01-01';

const aIso = (d: Date) => d.toISOString().slice(0, 10);

/** Rango de un atajo. `hoy` se pasa de afuera (UTC, sin tocar el reloj aquí) para poder probarlo. */
export function rangoDeAtajo(atajo: AtajoRango, hoy: Date): { desde: string; hasta: string } {
  const hasta = aIso(hoy);
  if (atajo === 'todo') return { desde: INICIO_HISTORICO, hasta };
  if (atajo === 'mes') return { desde: `${hasta.slice(0, 7)}-01`, hasta };
  const dias = atajo === '7d' ? 6 : 29;
  const ini = new Date(hoy.getTime() - dias * 86400000);
  return { desde: aIso(ini), hasta };
}

/** Atajo que corresponde al rango actual. Sin rango en la URL equivale al valor por defecto del endpoint (30 días). */
export function atajoActivo(f: FiltrosPantalla, hoy: Date): AtajoRango | null {
  if (!f.desde || !f.hasta) return '30d';
  for (const a of ['7d', '30d', 'mes', 'todo'] as const) {
    const r = rangoDeAtajo(a, hoy);
    if (r.desde === f.desde && r.hasta === f.hasta) return a;
  }
  return null;
}
