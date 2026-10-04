/** Piezas compartidas por las pestañas de /transformaciones y por /transformaciones/merma:
 *  esquema de filtros de la URL, etiquetas de categoría, búsqueda por código o material y lectura del umbral de merma. */

import { useEffect, useState } from 'react';
import { coincideCodigo, type Transformacion } from '@shared/types/index.js';
import { formatearKg, formatearKgDecimales } from '../../lib/formato';
import type { EsquemaFiltros } from '../../lib/filtros-url';
import { hoyLocal, rangoDeAtajo } from '../../lib/rango-fechas';
import { MERMA_MINIMA_ALERTA_KG, UMBRAL_MERMA_PCT_POR_DEFECTO } from '../../lib/transformaciones-kpis';
import { obtenerConfiguracionInventario } from '../../services/inventario-resumen-service';

export type PestanaTransformaciones = 'nueva' | 'pendientes' | 'historial' | 'config';
export const PESTANAS_TRANSFORMACIONES: readonly PestanaTransformaciones[] = ['nueva', 'pendientes', 'historial', 'config'];
export const CATEGORIAS_TRANSFORMACION = ['ferroso_no_ferroso', 'pcb'] as const;

/** Filtros de la URL de /transformaciones. Todos son nuevos y se AÑADEN: la clave de la pestaña recordada
 *  (pronoia:transformaciones:tab) no cambia; `tab` en la URL gana sobre ella cuando viene. */
export const ESQUEMA_FILTROS_TRANSFORMACIONES: EsquemaFiltros = {
  campos: {
    tab: { tipo: 'opcion', opciones: PESTANAS_TRANSFORMACIONES },
    desde: { tipo: 'fecha' },
    hasta: { tipo: 'fecha' },
    categoria: { tipo: 'opcion', opciones: CATEGORIAS_TRANSFORMACION },
    q: { tipo: 'texto' },
  },
  rangos: [['desde', 'hasta']],
};

export const ETIQUETA_CATEGORIA: Record<string, string> = {
  ferroso_no_ferroso: 'Ferroso / No ferroso',
  pcb: 'PCB',
};

export const etiquetaCategoria = (c: string): string => ETIQUETA_CATEGORIA[c] ?? c;

export const OPCIONES_FILTRO_CATEGORIA = CATEGORIAS_TRANSFORMACION.map(c => ({ valor: c, etiqueta: etiquetaCategoria(c) }));

/** Nombre del material de entrada (o del lote de origen en transformaciones antiguas). */
export const nombreEntrada = (t: Pick<Transformacion, 'nombreProductoEntrada' | 'nombreLoteOrigen'>): string =>
  t.nombreProductoEntrada ?? t.nombreLoteOrigen ?? '—';

/** Misma búsqueda que tenía la pantalla: código tolerante al formato o parte del nombre del material. */
export function coincideBusqueda(t: Transformacion, q: string | undefined): boolean {
  const texto = (q ?? '').trim();
  if (!texto) return true;
  return coincideCodigo(t.codigo, texto) || nombreEntrada(t).toLowerCase().includes(texto.toLowerCase());
}

/** Hoy según el reloj local, "AAAA-MM-DD". */
export const hoyIso = (): string => hoyLocal().toISOString().slice(0, 10);

/** Rango efectivo: el de la URL o, sin él, los últimos 30 días (lo mismo que resalta el atajo "30 días" del filtro). */
export function rangoEfectivo(desde: string | undefined, hasta: string | undefined): { desde: string; hasta: string } {
  if (desde && hasta) return { desde, hasta };
  return rangoDeAtajo('30d', hoyLocal());
}

export interface UmbralMerma {
  umbralPct: number;
  /** Merma mínima (kg) para que una transformación genere alerta. */
  minimoKg: number;
  /** true = no se pudo leer la configuración (otro permiso) y se usa el valor por defecto. */
  esPorDefecto: boolean;
}

/** Umbral de merma de la configuración del inventario (umbral_merma_pct). Esa lectura pide permiso de inventario: si no
 *  se puede, se usa el valor por defecto (8 %) y se avisa en pantalla. */
export function useUmbralMerma(): UmbralMerma {
  const [umbral, setUmbral] = useState<UmbralMerma>({ umbralPct: UMBRAL_MERMA_PCT_POR_DEFECTO, minimoKg: MERMA_MINIMA_ALERTA_KG, esPorDefecto: true });
  useEffect(() => {
    let cancelado = false;
    void obtenerConfiguracionInventario().then(c => {
      if (cancelado || !c || !(c.umbralMermaPct > 0)) return;
      setUmbral({ umbralPct: c.umbralMermaPct, minimoKg: c.alertaMermaMinKg ?? MERMA_MINIMA_ALERTA_KG, esPorDefecto: false });
    });
    return () => { cancelado = true; };
  }, []);
  return umbral;
}

/** Kg legibles: con 2 decimales si son menos de 100 (una transformación de 0,22 kg no debe verse como "0 kg") y enteros si no. */
export function kgFino(n: number): string {
  return Math.abs(n) >= 100 ? formatearKg(n) : formatearKgDecimales(n, 2);
}
