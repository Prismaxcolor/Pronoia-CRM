import { apiFetch } from './api-client';
import { PRODUCTOS_MOCK } from './mock-data';
import type {
  Producto,
  TipoProducto,
  VarianteProducto,
  SubProductoRef,
} from '@shared/types/index.js';

interface ProductoApi {
  id: string;
  nombre: string;
  descripcion: string;
  tipoMaterialId: string | null;
  tipoMaterialNombre: string | null;
  moneda: string;
  activo: boolean;
  tipo: TipoProducto;
  imagenUrl: string | null;
  creadoPor: string;
  creadoEn: string;
  peso?: number;
  costoUnitario?: number;
  variantes?: VarianteProducto[];
  subProductos?: SubProductoRef[];
  costoCalculado?: number;
}

function mapApi(api: ProductoApi): Producto {
  const base = {
    id: api.id,
    nombre: api.nombre,
    descripcion: api.descripcion,
    tipoMaterialId: api.tipoMaterialId,
    tipoMaterialNombre: api.tipoMaterialNombre,
    moneda: api.moneda,
    activo: api.activo,
    imagenUrl: api.imagenUrl,
    creadoPor: api.creadoPor,
    creadoEn: api.creadoEn,
  };
  if (api.tipo === 'azul') {
    return { ...base, tipo: 'azul', variantes: api.variantes ?? [] };
  }
  if (api.tipo === 'verde') {
    return {
      ...base,
      tipo: 'verde',
      subProductos: api.subProductos ?? [],
      costoCalculado: api.costoCalculado ?? 0,
    };
  }
  return {
    ...base,
    tipo: 'amarillo',
    peso: api.peso ?? 0,
    costoUnitario: api.costoUnitario ?? 0,
  };
}

export async function obtenerProductos(): Promise<Producto[]> {
  try {
    const { productos } = await apiFetch<{ productos: ProductoApi[] }>('/api/productos');
    return productos.map(mapApi);
  } catch {
    return PRODUCTOS_MOCK;
  }
}

export type ProductoInput = Omit<Producto, 'id' | 'creadoEn' | 'creadoPor'>;

export async function crearProducto(
  producto: ProductoInput
): Promise<{ producto: Producto } | { error: string }> {
  try {
    const { producto: creado } = await apiFetch<{ producto: ProductoApi }>('/api/productos', {
      method: 'POST',
      body: producto,
    });
    return { producto: mapApi(creado) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo crear el producto.' };
  }
}

export async function actualizarProducto(
  id: string,
  producto: ProductoInput
): Promise<{ producto: Producto } | { error: string }> {
  try {
    const { producto: act } = await apiFetch<{ producto: ProductoApi }>(`/api/productos/${id}`, {
      method: 'PATCH',
      body: producto,
    });
    return { producto: mapApi(act) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo actualizar el producto.' };
  }
}

export async function desactivarProducto(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/productos/${id}/desactivar`, { method: 'POST' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo desactivar el producto.' };
  }
}

export async function reactivarProducto(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/productos/${id}/reactivar`, { method: 'POST' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo reactivar el producto.' };
  }
}

export async function borrarProducto(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/api/productos/${id}`, { method: 'DELETE' });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo borrar el producto.' };
  }
}
