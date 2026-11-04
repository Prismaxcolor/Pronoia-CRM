import { supabaseAdmin } from '../config/supabase.js';
import type { TipoEntidad } from './estado-cuenta-service.js';
import { formatCodigoAdelanto, formatCodigoAnticipoCliente } from '../utils/codigos.js';

/** Fila tal cual la devuelve la función SQL adelantos_disponibles(). */
interface AdelantoDisponibleRow {
  adelanto_id: string;
  numero: number | null;
  fecha: string;
  descripcion: string | null;
  total: number | string;
  aplicado: number | string;
  disponible: number | string;
}

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

/** Centavos de tolerancia: por debajo de esto el adelanto se considera consumido. */
const DISPONIBLE_MINIMO = 0.01;

/** Función pura (testeable sin BD): solo adelantos con saldo, con código formateado. */
export function mapearAdelantosDisponibles(rows: AdelantoDisponibleRow[], tipoEntidad: TipoEntidad): AdelantoDisponible[] {
  const formatear = tipoEntidad === 'proveedor' ? formatCodigoAdelanto : formatCodigoAnticipoCliente;
  return rows
    .map(r => ({
      id: r.adelanto_id,
      codigo: r.numero != null ? formatear(Number(r.numero)) : null,
      fecha: String(r.fecha).slice(0, 10),
      descripcion: r.descripcion,
      total: Number(r.total),
      aplicado: Number(r.aplicado),
      disponible: Number(r.disponible),
    }))
    .filter(a => a.disponible >= DISPONIBLE_MINIMO);
}

/** Adelantos (proveedor) o anticipos (cliente) con saldo sin aplicar a facturas,
 *  para cruzarlos al registrar un pago/cobro. */
export async function listarAdelantosDisponibles(
  tipoEntidad: TipoEntidad,
  entidadId: string
): Promise<AdelantoDisponible[] | { error: string }> {
  const { data, error } = await supabaseAdmin.rpc('adelantos_disponibles', {
    p_es_proveedor: tipoEntidad === 'proveedor',
    p_entidad_id: entidadId,
  });
  if (error) return { error: 'No se pudieron cargar los adelantos disponibles.' };
  return mapearAdelantosDisponibles((data as AdelantoDisponibleRow[] | null) ?? [], tipoEntidad);
}
