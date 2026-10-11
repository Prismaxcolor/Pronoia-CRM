import { apiFetch } from './api-client';
import type { CategoriaWallet, ReporteCategorias, ReporteCuenta, TipoCategoria } from '@shared/types/index.js';

export type Resultado<T> = T | { error: string };

export interface CategoriaInput {
  nombre: string;
  tipo: TipoCategoria;
  color: string;
  /** Con valor se crea una subcategoría de esa categoría. */
  padreId?: string | null;
}

export interface CategoriaCambios {
  nombre?: string;
  tipo?: TipoCategoria;
  color?: string;
  /** false archiva (y archiva sus subcategorías); true restaura. */
  activo?: boolean;
}

async function ejecutar<T>(accion: () => Promise<T>, porDefecto: string): Promise<Resultado<T>> {
  try {
    return await accion();
  } catch (e) {
    return { error: e instanceof Error && e.message ? e.message : porDefecto };
  }
}

/** Todas las categorías (activas y archivadas: los movimientos viejos pueden usar una archivada). */
export const obtenerCategorias = () =>
  ejecutar(() => apiFetch<{ categorias: CategoriaWallet[] }>('/api/cochinito/categorias'), 'No se pudieron cargar las categorías.');

export const crearCategoria = (input: CategoriaInput) =>
  ejecutar(() => apiFetch<{ categoria: CategoriaWallet }>('/api/cochinito/categorias', { method: 'POST', body: input }), 'No se pudo crear la categoría.');

export const actualizarCategoria = (id: string, cambios: CategoriaCambios) =>
  ejecutar(
    () => apiFetch<{ categoria: CategoriaWallet }>(`/api/cochinito/categorias/${id}`, { method: 'PATCH', body: cambios }),
    'No se pudo actualizar la categoría.',
  );

/** Cambia (o quita, con null) solo la categoría de un movimiento manual; no toca montos ni saldos. */
export const cambiarCategoriaMovimiento = (movimientoId: string, categoriaId: string | null) =>
  ejecutar(
    () => apiFetch<{ ok: true; categoriaId: string | null }>(`/api/cochinito/movimientos/${movimientoId}/categoria`, { method: 'PATCH', body: { categoriaId } }),
    'No se pudo cambiar la categoría del movimiento.',
  );

export const obtenerReporteCuenta = (bancaId: string, desde: string, hasta: string) => {
  const q = new URLSearchParams({ bancaId, desde, hasta });
  return ejecutar(() => apiFetch<ReporteCuenta>(`/api/cochinito/reportes/cuenta?${q.toString()}`), 'No se pudo generar el reporte de la cuenta.');
};

export interface FiltroReporteCategorias {
  /** Vacío = todas las categorías. */
  categorias: readonly string[];
  desde: string;
  hasta: string;
  incluirSinCategoria: boolean;
}

export const obtenerReporteCategorias = (f: FiltroReporteCategorias) => {
  const q = new URLSearchParams({ desde: f.desde, hasta: f.hasta, sinCategoria: String(f.incluirSinCategoria) });
  if (f.categorias.length > 0) q.set('categorias', f.categorias.join(','));
  return ejecutar(() => apiFetch<ReporteCategorias>(`/api/cochinito/reportes/categorias?${q.toString()}`), 'No se pudo generar el reporte por categorías.');
};
