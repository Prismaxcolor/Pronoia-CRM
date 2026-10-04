/** Lógica pura de la pantalla Métricas de compras (sin React ni DOM; se prueba desde
 *  backend/tests/dashboard-metricas-kpis.test.ts). Agrupa las líneas de GET /api/metricas/compras. */

import type { MetricaCompraLinea } from '../services/metricas-service';
import type { EsquemaFiltros, ValoresFiltros } from './filtros-url';
import { compararConPeriodoAnterior, type ComparacionPeriodo, type MejorCuando } from './comparacion';
import { FECHA_INICIO_DATOS_REALES, sumarDiasIso, type PuntoDia } from './dashboard-kpis';

export interface Agregado {
  id: string;
  nombre: string;
  categoria: string | null;
  kg: number;
  costo: number;
  contraparteCount: number;
  comprasCount: number;
  precioMinKg: number;
  precioMaxKg: number;
}

type Clave = (l: MetricaCompraLinea) => string;

/** Agrupa líneas por una clave sumando kg/costo, contando facturas y contrapartes distintas y el rango de $/kg. */
export function agregarPor(
  lineas: readonly MetricaCompraLinea[],
  clave: Clave,
  nombre: Clave,
  contraparte: Clave,
  categoria: (l: MetricaCompraLinea) => string | null,
): Agregado[] {
  interface Acc { nombre: string; categoria: string | null; kg: number; costo: number; contrapartes: Set<string>; facturas: Set<string>; precioMin: number; precioMax: number }
  const mapa = new Map<string, Acc>();
  for (const l of lineas) {
    const id = clave(l);
    const precioKg = l.kg > 0 ? l.costo / l.kg : 0;
    const ex = mapa.get(id);
    if (ex) {
      ex.kg += l.kg;
      ex.costo += l.costo;
      ex.contrapartes.add(contraparte(l));
      ex.facturas.add(l.facturaId);
      ex.precioMin = Math.min(ex.precioMin, precioKg);
      ex.precioMax = Math.max(ex.precioMax, precioKg);
    } else {
      mapa.set(id, {
        nombre: nombre(l), categoria: categoria(l), kg: l.kg, costo: l.costo,
        contrapartes: new Set([contraparte(l)]), facturas: new Set([l.facturaId]),
        precioMin: precioKg, precioMax: precioKg,
      });
    }
  }
  return Array.from(mapa.entries())
    .map(([id, v]) => ({
      id, nombre: v.nombre, categoria: v.categoria, kg: v.kg, costo: v.costo,
      contraparteCount: v.contrapartes.size, comprasCount: v.facturas.size,
      precioMinKg: v.precioMin, precioMaxKg: v.precioMax,
    }))
    .sort((a, b) => b.kg - a.kg);
}

export const claveMaterial = (l: MetricaCompraLinea): string => l.productoId ?? l.nombreProducto;

export function porMaterialDe(lineas: readonly MetricaCompraLinea[]): Agregado[] {
  return agregarPor(lineas, claveMaterial, l => l.nombreProducto, l => l.proveedorId, l => l.tipoMaterialNombre);
}

export function porProveedorDe(lineas: readonly MetricaCompraLinea[]): Agregado[] {
  return agregarPor(lineas, l => l.proveedorId, l => l.nombreProveedor, claveMaterial, () => null);
}

export interface ResumenCompras {
  kgTotal: number;
  costoTotal: number;
  costoPromedioKg: number;
  proveedoresCount: number;
  materialesCount: number;
  comprasCount: number;
}

export function resumirCompras(ls: readonly MetricaCompraLinea[]): ResumenCompras {
  const kgTotal = ls.reduce((s, l) => s + l.kg, 0);
  const costoTotal = ls.reduce((s, l) => s + l.costo, 0);
  return {
    kgTotal,
    costoTotal,
    costoPromedioKg: kgTotal > 0 ? costoTotal / kgTotal : 0,
    proveedoresCount: new Set(ls.map(l => l.proveedorId)).size,
    materialesCount: new Set(ls.map(claveMaterial)).size,
    comprasCount: new Set(ls.map(l => l.facturaId)).size,
  };
}

/** Días entre dos fechas ISO, ambas incluidas. */
export function diasEntre(desde: string, hasta: string): number {
  const ms = Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/** Periodo inmediatamente anterior y de la misma duración. */
export function rangoAnterior(desde: string, hasta: string): { desde: string; hasta: string; dias: number } {
  const dias = diasEntre(desde, hasta);
  const haAnterior = sumarDiasIso(desde, -1);
  return { desde: sumarDiasIso(haAnterior, -(dias - 1)), hasta: haAnterior, dias };
}

/** El periodo anterior solo es comparable si tiene compras y empieza cuando ya había registro real. */
export function anteriorEsComparable(desdeAnterior: string, lineasAnterior: number): boolean {
  return lineasAnterior > 0 && desdeAnterior >= FECHA_INICIO_DATOS_REALES;
}

/** Comparación vs periodo anterior. `mejorCuando` null = sin juicio de valor (tono neutro). null si no es comparable. */
export function compararMetrica(
  actual: number,
  anterior: number,
  comparable: boolean,
  mejorCuando: MejorCuando | null,
): ComparacionPeriodo | null {
  if (!comparable) return null;
  const c = compararConPeriodoAnterior(actual, anterior, mejorCuando ?? 'sube');
  if (!c) return null;
  return mejorCuando ? c : { ...c, tono: 'neutro' };
}

/** Lunes de la semana de una fecha ISO. */
export function lunesDe(iso: string): string {
  const dia = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0=domingo
  return sumarDiasIso(iso, -((dia + 6) % 7));
}

export const DIAS_MAX_TENDENCIA_DIARIA = 35;

export interface TendenciaCompras {
  porSemana: boolean;
  puntos: PuntoDia[];
}

/** Kg por día (o por semana si el rango pasa de 35 días), con ceros en los huecos. */
export function tendenciaCompras(lineas: readonly MetricaCompraLinea[], desde: string, hasta: string): TendenciaCompras {
  const porSemana = diasEntre(desde, hasta) > DIAS_MAX_TENDENCIA_DIARIA;
  const mapa = new Map<string, number>();
  for (const l of lineas) {
    const clave = porSemana ? lunesDe(l.fecha) : l.fecha;
    mapa.set(clave, (mapa.get(clave) ?? 0) + l.kg);
  }
  const puntos: PuntoDia[] = [];
  const paso = porSemana ? 7 : 1;
  const inicio = porSemana ? lunesDe(desde) : desde;
  for (let f = inicio; f <= hasta; f = sumarDiasIso(f, paso)) puntos.push({ fecha: f, kg: mapa.get(f) ?? 0 });
  return { porSemana, puntos };
}

const sinTildes = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Filtro de texto (sin tildes ni mayúsculas) sobre el nombre. */
export function filtrarPorNombre<T extends { nombre: string }>(lista: readonly T[], texto: string | undefined): T[] {
  const q = sinTildes((texto ?? '').trim());
  if (!q) return [...lista];
  return lista.filter(i => sinTildes(i.nombre).includes(q));
}

/** Líneas que cumplen las selecciones de material y/o proveedor (las dos, si están ambas). */
export function filtrarLineas(
  lineas: readonly MetricaCompraLinea[],
  material: string | undefined,
  proveedor: string | undefined,
): MetricaCompraLinea[] {
  return lineas.filter(l => (!material || claveMaterial(l) === material) && (!proveedor || l.proveedorId === proveedor));
}

// ---------------------------------------------------------------- secciones de Métricas

export const SECCIONES_METRICAS = ['compras', 'inventario'] as const;
export type SeccionMetricas = (typeof SECCIONES_METRICAS)[number];

/** Esquema de la URL para cambiar de sección. Incluye los filtros propios de cada sección (q, categoria, soloSinCosto)
 *  para que `escribirFiltros` pueda BORRARLOS al cambiar: las claves fuera del esquema se ignoran en los cambios. */
export const ESQUEMA_SECCION_METRICAS: EsquemaFiltros = {
  campos: {
    seccion: { tipo: 'opcion', opciones: SECCIONES_METRICAS },
    q: { tipo: 'texto' },
    categoria: { tipo: 'texto' },
    soloSinCosto: { tipo: 'bandera' },
  },
};

/** Cambios de URL al elegir una sección: fija la sección y limpia los filtros que significan cosas distintas en cada una. */
export function cambiosAlElegirSeccion(seccion: SeccionMetricas): ValoresFiltros {
  return { seccion, q: undefined, categoria: undefined, soloSinCosto: undefined };
}
