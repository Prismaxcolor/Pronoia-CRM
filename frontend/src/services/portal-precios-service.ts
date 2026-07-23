import { portalApiFetch } from './portal-api-client';

export interface PrecioMaterial {
  id: string;
  productoId: string;
  precio: number;
  nombreProducto?: string;
}

export interface ListaPreciosPortal {
  lista: { id: string; nombre: string; vigenteDesde: string | null };
  precios: PrecioMaterial[];
}

export async function obtenerPreciosPortal(): Promise<ListaPreciosPortal[]> {
  try {
    const result = await portalApiFetch<{ listas: ListaPreciosPortal[] }>('/api/portal/precios');
    return result.listas;
  } catch {
    return [];
  }
}
