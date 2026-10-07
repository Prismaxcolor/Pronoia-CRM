import { apiFetch } from './api-client';

export interface ArticuloInventario {
  productoId: string;
  nombre: string;
  destinoTipo: 'mpp' | 'lote' | 'sin_movimiento';
  loteId: string | null;
  destinoLabel: string;
  entradas: number;
  salidas: number;
  transformaciones: number;
  ajustes: number;
  stock: number;
  /** Solo con filtro por almacén: movimientos que explican el stock. */
  desglose?: DesgloseArticulo;
}

/** stock = compras − ventas + trasladoEntrada − trasladoSalida − transfEntrada + transfSalida + ajustes */
export interface DesgloseArticulo {
  compras: number;
  ventas: number;
  trasladoEntrada: number;
  trasladoSalida: number;
  /** Material consumido por transformaciones. */
  transfEntrada: number;
  /** Material producido por transformaciones. */
  transfSalida: number;
  ajustes: number;
}

export interface GrupoInventario {
  tipoMaterialId: string | null;
  nombreCategoria: string;
  totalKg: number;
  articulos: ArticuloInventario[];
}

export interface FiltrosInventario {
  tipoMaterialId?: string;
  productoId?: string;
  desde?: string;
  hasta?: string;
  almacenId?: string;
}

export async function obtenerInventario(filtros: FiltrosInventario = {}): Promise<GrupoInventario[]> {
  const params = new URLSearchParams();
  if (filtros.tipoMaterialId) params.set('tipoMaterialId', filtros.tipoMaterialId);
  if (filtros.productoId) params.set('productoId', filtros.productoId);
  if (filtros.desde) params.set('desde', filtros.desde);
  if (filtros.hasta) params.set('hasta', filtros.hasta);
  if (filtros.almacenId) params.set('almacenId', filtros.almacenId);
  const qs = params.toString();
  try {
    const { grupos } = await apiFetch<{ grupos: GrupoInventario[] }>(`/api/inventario${qs ? `?${qs}` : ''}`);
    return grupos;
  } catch {
    return [];
  }
}

/** Vacía el producto DESECHOS (lo deja en 0 kg). El servidor rechaza cualquier otro producto. */
export async function vaciarDesechos(productoId: string): Promise<{ kgVaciados: number } | { error: string }> {
  try {
    const { kgVaciados } = await apiFetch<{ kgVaciados: number }>(`/api/inventario/desechos/${productoId}/vaciar`, {
      method: 'POST',
    });
    return { kgVaciados };
  } catch (err) {
    return { error: err instanceof Error && err.message ? err.message : 'No se pudo vaciar los desechos.' };
  }
}
