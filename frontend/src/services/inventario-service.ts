import { apiFetch } from './api-client';

export interface ArticuloInventario {
  productoId: string;
  nombre: string;
  entradas: number;
  salidas: number;
  transformaciones: number;
  stock: number;
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
}

export async function obtenerInventario(filtros: FiltrosInventario = {}): Promise<GrupoInventario[]> {
  const params = new URLSearchParams();
  if (filtros.tipoMaterialId) params.set('tipoMaterialId', filtros.tipoMaterialId);
  if (filtros.productoId) params.set('productoId', filtros.productoId);
  if (filtros.desde) params.set('desde', filtros.desde);
  if (filtros.hasta) params.set('hasta', filtros.hasta);
  const qs = params.toString();
  try {
    const { grupos } = await apiFetch<{ grupos: GrupoInventario[] }>(`/api/inventario${qs ? `?${qs}` : ''}`);
    return grupos;
  } catch {
    return [];
  }
}
