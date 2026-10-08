/** Lógica pura (sin React) de las pantallas de Toma física: indicadores del listado, diferencias por almacén, semáforo
 *  de cada línea (con texto, no solo color), avance del conteo y filtros. Se prueba desde backend/tests.
 *  Una toma CERRADA trae `snapshotResumen` (foto del teórico vs real al culminar); una ABIERTA no: su diferencia
 *  se ve en el detalle (resumen en vivo) y aquí cuenta como "pendiente". */

import type { Tono } from './paleta';

export interface LineaResumen {
  productoId: string | null;
  loteId: string | null;
  stockTeorico: number;
  stockReal: number;
  diferencia: number;
  cantidadPesajes: number;
}

export type EstadoToma = 'abierta' | 'cerrada' | 'cancelada';

export interface TomaBasica {
  id: string;
  codigo: string;
  descripcion: string | null;
  almacenId: string;
  almacenNombre: string | null;
  alcance: 'categoria' | 'lote' | string;
  estado: EstadoToma | string;
  categoriaNombres: readonly string[];
  loteNombres: readonly string[];
  abiertaEn: string;
  cerradaEn: string | null;
  snapshotResumen?: readonly LineaResumen[] | null;
}

/** Diferencia menor o igual a esta cantidad de kg se considera "cuadra" (ruido de redondeo de la báscula). */
export const KG_TOLERANCIA_CUADRA = 0.005;
/** Hasta este % del teórico la diferencia es menor (aviso suave); por encima es notable y pide revisión. */
export const PCT_DIFERENCIA_MENOR = 2;

export type NivelDiferencia = 'sin-contar' | 'cuadra' | 'menor' | 'notable';

export interface SemaforoDiferencia {
  nivel: NivelDiferencia;
  tono: Tono;
  /** Texto que dice lo mismo que el color. */
  etiqueta: string;
  /** Porcentaje absoluto sobre el teórico (null si el teórico es 0 o no se contó). */
  pct: number | null;
}

export function sumarDiferencias(lineas: readonly Pick<LineaResumen, 'diferencia'>[]): number {
  return lineas.reduce((acc, l) => acc + (Number.isFinite(l.diferencia) ? l.diferencia : 0), 0);
}

/** Líneas con diferencia distinta de cero = ajustes de inventario que aplica (o aplicó) el cierre. */
export function contarAjustes(lineas: readonly Pick<LineaResumen, 'diferencia'>[]): number {
  return lineas.filter(l => Math.abs(l.diferencia) > KG_TOLERANCIA_CUADRA).length;
}

/** Semáforo de una línea: cuadra / diferencia menor / diferencia notable. Siempre con texto de faltante o sobrante. */
export function clasificarDiferencia(
  l: Pick<LineaResumen, 'stockTeorico' | 'stockReal' | 'diferencia' | 'cantidadPesajes'>,
): SemaforoDiferencia {
  if (l.cantidadPesajes <= 0) {
    return { nivel: 'sin-contar', tono: 'neutral', etiqueta: 'Sin contar', pct: null };
  }
  const abs = Math.abs(l.diferencia);
  if (abs <= KG_TOLERANCIA_CUADRA) return { nivel: 'cuadra', tono: 'exito', etiqueta: 'Cuadra', pct: 0 };
  const sentido = l.diferencia < 0 ? 'Faltante' : 'Sobrante';
  const pct = l.stockTeorico > 0 ? (abs / l.stockTeorico) * 100 : null;
  // Sin teórico (material que el sistema no sabía que estaba) siempre es notable.
  if (pct === null || pct > PCT_DIFERENCIA_MENOR) return { nivel: 'notable', tono: 'aviso', etiqueta: `${sentido} notable`, pct };
  return { nivel: 'menor', tono: 'info', etiqueta: `${sentido} menor`, pct };
}

export interface AvanceConteo {
  contadas: number;
  total: number;
  faltan: number;
  /** 0-100. */
  pct: number;
}

export function avanceConteo(lineas: readonly Pick<LineaResumen, 'cantidadPesajes'>[]): AvanceConteo {
  const total = lineas.length;
  const contadas = lineas.filter(l => l.cantidadPesajes > 0).length;
  return { contadas, total, faltan: total - contadas, pct: total > 0 ? (contadas / total) * 100 : 0 };
}

// ── Listado ──────────────────────────────────────────────────────────────────

export interface ResumenTomas {
  abiertas: number;
  cerradas: number;
  canceladas: number;
  /** Suma de diferencias de las tomas cerradas con foto guardada (kg; negativo = faltante neto). */
  diferenciaNetaKg: number;
  /** Líneas ajustadas (diferencia distinta de cero) en las tomas cerradas. */
  ajustes: number;
  /** Cerradas con foto del resumen; las demás no aportan a diferencia ni ajustes. */
  cerradasConDatos: number;
}

export function resumirTomas(tomas: readonly TomaBasica[]): ResumenTomas {
  let diferenciaNetaKg = 0;
  let ajustes = 0;
  let cerradasConDatos = 0;
  for (const t of tomas) {
    if (t.estado !== 'cerrada' || !t.snapshotResumen) continue;
    cerradasConDatos += 1;
    diferenciaNetaKg += sumarDiferencias(t.snapshotResumen);
    ajustes += contarAjustes(t.snapshotResumen);
  }
  return {
    abiertas: tomas.filter(t => t.estado === 'abierta').length,
    cerradas: tomas.filter(t => t.estado === 'cerrada').length,
    canceladas: tomas.filter(t => t.estado === 'cancelada').length,
    diferenciaNetaKg,
    ajustes,
    cerradasConDatos,
  };
}

export interface DiferenciaAlmacen {
  almacen: string;
  /** Suma de |diferencia| (kg movidos por los ajustes). */
  kgAbsolutos: number;
  /** Suma con signo (negativo = faltante neto). */
  kgNetos: number;
  tomas: number;
}

/** Diferencia por almacén sobre las tomas cerradas con foto. Ordenado de más a menos kg absolutos. */
export function diferenciasPorAlmacen(tomas: readonly TomaBasica[]): DiferenciaAlmacen[] {
  const mapa = new Map<string, DiferenciaAlmacen>();
  for (const t of tomas) {
    if (t.estado !== 'cerrada' || !t.snapshotResumen) continue;
    const nombre = t.almacenNombre ?? 'Sin almacén';
    const previo = mapa.get(nombre) ?? { almacen: nombre, kgAbsolutos: 0, kgNetos: 0, tomas: 0 };
    mapa.set(nombre, {
      almacen: nombre,
      kgAbsolutos: previo.kgAbsolutos + t.snapshotResumen.reduce((a, l) => a + Math.abs(l.diferencia), 0),
      kgNetos: previo.kgNetos + sumarDiferencias(t.snapshotResumen),
      tomas: previo.tomas + 1,
    });
  }
  return [...mapa.values()].sort((a, b) => b.kgAbsolutos - a.kgAbsolutos);
}

export interface FiltrosTomas {
  estado?: string;
  almacen?: string;
  q?: string;
}

const normalizar = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Filtra por estado, almacén (id) y texto libre (código, descripción, almacén, categorías, lotes). No muta la entrada. */
export function filtrarTomas<T extends TomaBasica>(tomas: readonly T[], f: FiltrosTomas): T[] {
  const q = f.q ? normalizar(f.q) : '';
  return tomas.filter(t => {
    if (f.estado && t.estado !== f.estado) return false;
    if (f.almacen && t.almacenId !== f.almacen) return false;
    if (!q) return true;
    const pajar = normalizar([t.codigo, t.descripcion ?? '', t.almacenNombre ?? '', ...t.categoriaNombres, ...t.loteNombres].join(' '));
    return pajar.includes(q);
  });
}

/** Resumen de diferencia de UNA toma para el listado: null si no hay foto (abierta, cancelada o cerrada antigua). */
export function diferenciaDeToma(t: Pick<TomaBasica, 'estado' | 'snapshotResumen'>): { netoKg: number; ajustes: number } | null {
  if (t.estado !== 'cerrada' || !t.snapshotResumen) return null;
  return { netoKg: sumarDiferencias(t.snapshotResumen), ajustes: contarAjustes(t.snapshotResumen) };
}
