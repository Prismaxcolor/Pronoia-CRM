/** Filtros de Registros en la URL (lógica pura). Se prueba en backend/tests/wallet-registros-filtros.test.ts.
 *  Reutiliza los de la Wallet clásica (filtrarMovimientos / resolverFiltroCategoria) para no duplicar reglas.
 *
 *  Parámetros: p (7D…1A, TODO), desde+hasta (rango personalizado), banca (ids separados por coma), tipo, subtipo
 *  (pago/adelanto), categoria y subcategoria (como la clásica) y `cat` (id de categoría o subcategoría: el enlace corto que
 *  usa Estadísticas, p. ej. /wallet/registros?cat=<id>&p=30D). `sinanulados=1` oculta los anulados (por defecto se ven tachados). */

import type { CategoriaWallet, Movimiento } from '@shared/types/index.js';
import { SUBTIPOS_EGRESO, TIPOS_MOVIMIENTO, filtrarMovimientos, type NombreContraparte } from '../../../lib/cochinito-kpis';
import { VALOR_SIN_CATEGORIA, resolverFiltroCategoria } from '../../cochinito/categorias/categorias-logica';
import { filtrarPorCuentas } from './registros-logica';

export const ESQUEMA_REGISTROS = {
  campos: {
    p: { tipo: 'texto' },
    desde: { tipo: 'fecha' },
    hasta: { tipo: 'fecha' },
    banca: { tipo: 'texto' },
    tipo: { tipo: 'opcion', opciones: TIPOS_MOVIMIENTO },
    subtipo: { tipo: 'opcion', opciones: SUBTIPOS_EGRESO },
    categoria: { tipo: 'texto' },
    subcategoria: { tipo: 'texto' },
    cat: { tipo: 'texto' },
    sinanulados: { tipo: 'bandera' },
  },
  rangos: [['desde', 'hasta']],
} as const;

export interface EleccionCategoriaUrl {
  categoria?: string;
  subcategoria?: string;
}

/** Categoría/subcategoría efectivas: las explícitas mandan; si solo hay `cat` se deduce si es raíz o subcategoría. */
export function eleccionCategoriaDeUrl(
  v: { cat?: string; categoria?: string; subcategoria?: string },
  categorias: readonly CategoriaWallet[],
): EleccionCategoriaUrl {
  if (v.categoria || v.subcategoria) return { categoria: v.categoria, subcategoria: v.subcategoria };
  if (!v.cat) return {};
  if (v.cat === VALOR_SIN_CATEGORIA) return { categoria: VALOR_SIN_CATEGORIA };
  const c = categorias.find(x => x.id === v.cat);
  if (!c) return {};
  return c.padreId ? { categoria: c.padreId, subcategoria: c.id } : { categoria: c.id };
}

export interface FiltrosRegistros extends EleccionCategoriaUrl {
  q: string;
  desde: string;
  hasta: string;
  tipo?: string;
  subtipo?: string;
  cuentas: readonly string[];
  incluirAnulados: boolean;
  categorias: readonly CategoriaWallet[];
}

/** Movimientos que cumplen todos los filtros (se combinan con "y"). Devuelve un arreglo nuevo. */
export function filtrarRegistros(movimientos: readonly Movimiento[], f: FiltrosRegistros, nombreContraparte?: NombreContraparte): Movimiento[] {
  const base = filtrarMovimientos(
    movimientos,
    {
      q: f.q, desde: f.desde, hasta: f.hasta, tipo: f.tipo, subtipo: f.subtipo,
      ...resolverFiltroCategoria({ categoria: f.categoria, subcategoria: f.subcategoria }, f.categorias),
    },
    nombreContraparte,
  );
  const conCuentas = filtrarPorCuentas(base, f.cuentas);
  return f.incluirAnulados ? conCuentas : conCuentas.filter(m => !m.anulado);
}

type ValoresUrl = Partial<Record<keyof typeof ESQUEMA_REGISTROS.campos, string | boolean | undefined>>;

/** Filtros del diálogo "Filtros" activos: tipo, pago/adelanto, categoría y subcategoría (las explícitas mandan sobre `cat`) y anulados. */
export function contarFiltrosAvanzados(v: ValoresUrl): number {
  const categorias = v.categoria || v.subcategoria
    ? [v.categoria, v.subcategoria].filter(Boolean).length
    : v.cat ? 1 : 0;
  return [v.tipo, v.subtipo].filter(Boolean).length + categorias + (v.sinanulados ? 1 : 0);
}

/** `cat` de la URL que ya no corresponde a ninguna categoría (borrada, enlace viejo). Si hay categoría o subcategoría
 *  explícitas, `cat` se ignora. Llamar solo cuando las categorías ya cargaron. */
export function categoriaUrlDesconocida(
  v: { cat?: string; categoria?: string; subcategoria?: string },
  categorias: readonly CategoriaWallet[],
): boolean {
  if (!v.cat || v.categoria || v.subcategoria || v.cat === VALOR_SIN_CATEGORIA) return false;
  return !categorias.some(c => c.id === v.cat);
}

export function hayFiltrosActivos(o: { q: string; cuentas: number; avanzados: number }): boolean {
  return o.q !== '' || o.cuentas > 0 || o.avanzados > 0;
}
