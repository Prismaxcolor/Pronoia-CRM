import { apiFetch } from './api-client';
import type { TipoEntidad } from './estado-cuenta-service';

export interface AdelantoDisponible {
  /** Va como `id` de un ítem tipo 'adelanto' al registrar un pago/cobro. */
  id: string;
  /** AD-0001 (proveedor) / AC-0001 (cliente). */
  codigo: string | null;
  fecha: string;
  descripcion: string | null;
  total: number;
  aplicado: number;
  disponible: number;
}

/** Adelantos (proveedor) o anticipos (cliente) con saldo sin aplicar a facturas,
 *  para cruzarlos al registrar un pago/cobro. Lista vacía si falla la carga. */
export async function obtenerAdelantosDisponibles(tipo: TipoEntidad, entidadId: string): Promise<AdelantoDisponible[]> {
  try {
    return await obtenerAdelantosDisponiblesOError(tipo, entidadId);
  } catch {
    return [];
  }
}

/** Igual que `obtenerAdelantosDisponibles`, pero lanza el error si la carga falla (no lo disfraza de "sin adelantos"). */
export async function obtenerAdelantosDisponiblesOError(tipo: TipoEntidad, entidadId: string): Promise<AdelantoDisponible[]> {
  const base = tipo === 'proveedor' ? '/api/proveedores' : '/api/clientes';
  const { adelantos } = await apiFetch<{ adelantos: AdelantoDisponible[] }>(`${base}/${entidadId}/adelantos-disponibles`);
  return adelantos;
}
