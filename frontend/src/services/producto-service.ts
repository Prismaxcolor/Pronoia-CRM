import { apiFetch } from './api-client';
import { altaMaestroF4, fotosYaSubidas, provisionalesDeMaestro } from './maestros-cola';
import { offlineHabilitado } from '../lib/offline/sesion';
import type { FotoLocal } from '../lib/foto-picker';
import { obtenerCatalogo } from '../lib/offline/catalogos';
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
  tipoMaterialSinLote: boolean | null;
  loteIds?: string[];
  estadoLimpieza?: 'limpio' | 'sucio' | null;
  moneda: string;
  activo: boolean;
  tipo: TipoProducto;
  fotos: string[];
  creadoPor: string;
  creadoEn: string;
  peso?: number;
  variantes?: VarianteProducto[];
  subProductos?: SubProductoRef[];
}

function mapApi(api: ProductoApi): Producto {
  const base = {
    id: api.id,
    nombre: api.nombre,
    descripcion: api.descripcion,
    tipoMaterialId: api.tipoMaterialId,
    tipoMaterialNombre: api.tipoMaterialNombre,
    tipoMaterialSinLote: api.tipoMaterialSinLote,
    loteIds: api.loteIds ?? [],
    estadoLimpieza: api.estadoLimpieza ?? null,
    moneda: api.moneda,
    activo: api.activo,
    fotos: api.fotos,
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
    };
  }
  return {
    ...base,
    tipo: 'amarillo',
    peso: api.peso ?? 0,
  };
}

export async function obtenerProductos(): Promise<Producto[]> {
  try {
    const { datos } = await obtenerCatalogo('productos', async () => {
      const { productos } = await apiFetch<{ productos: ProductoApi[] }>('/api/productos');
      return productos.map(mapApi);
    });
    return [...datos, ...(await provisionalesDeMaestro<Producto>('producto'))];
  } catch {
    return PRODUCTOS_MOCK;
  }
}

export type ProductoInput = Omit<Producto, 'id' | 'creadoEn' | 'creadoPor'>;

export async function crearProducto(
  producto: ProductoInput,
  fotosLocales?: FotoLocal[]
): Promise<{ producto: Producto; enCola?: true } | { error: string }> {
  if (offlineHabilitado()) {
    const { fotos, ...datos } = producto;
    const r = await altaMaestroF4<ProductoApi>('producto', datos, fotosLocales ?? fotosYaSubidas(fotos));
    if ('error' in r) return r;
    return { producto: mapApi(r.entidad), ...(r.enCola ? { enCola: true as const } : {}) };
  }
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

/** Persiste el nuevo orden del catálogo: ids en el orden deseado, de arriba a abajo. */
export async function reordenarProductos(ids: string[]): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch('/api/productos/reordenar', { method: 'PATCH', body: { ids } });
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'No se pudo reordenar el catálogo.' };
  }
}
