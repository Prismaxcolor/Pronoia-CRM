import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { mensajeDeErrorBd } from '../utils/errores-bd.js';
import { esObjetoInexistente, MENSAJE_INVENTARIO_NO_HABILITADO } from '../utils/migracion-pendiente.js';
import { construirCostosInventario } from '../utils/costos-inventario.js';
import type { CostosInventario } from '../../../shared/types/inventario-pantalla.js';
import type { ActualizarCostosInput } from '../schemas/inventario-costos.js';
import { registrarAuditoria } from './auditoria-service.js';
import { obtenerBasePantalla } from './inventario-pantalla-service.js';
import { invalidarCacheResumen } from './resumen-cache.js';

export const ADVERTENCIA_AUDITORIA_COSTOS =
  'Los costos se guardaron, pero no se pudieron registrar en el historial de cambios. Avisa al administrador.';

/** Costo de facturas, referencia manual y costo efectivo de los productos con stock. Requiere facturacion:ver (lo exige la ruta). */
export async function obtenerCostosInventario(): Promise<CostosInventario> {
  const base = await obtenerBasePantalla(true);
  return construirCostosInventario({ almacenes: base.almacenes, productos: base.movimientos.productos, costos: base.costos });
}

export interface ActorCostos {
  userId: string;
  email?: string;
}

export type ActualizarCostosResult =
  | { ok: true; costos: CostosInventario; cambiados: number; advertencia?: string }
  | { ok: false; error: string; status: 400 | 409 | 500 };

interface ProductoCostoRow {
  id: string;
  nombre: string;
  costo_referencia_kg: number | string | null;
}

const aNumeroONull = (v: number | string | null): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Guarda los costos de referencia en lote. Solo se escriben los que cambian; la escritura es una sola
 * transacción (función actualizar_costos_referencia): o se guardan todos o ninguno. Deja rastro en
 * productos.costo_referencia_actualizado_* y en el historial de auditoría, y vacía las cachés de la pantalla.
 */
export async function actualizarCostosReferencia(entrada: ActualizarCostosInput, actor: ActorCostos): Promise<ActualizarCostosResult> {
  const ids = entrada.items.map(i => i.productoId);
  const { data, error } = await supabaseAdmin.from('productos').select('id, nombre, costo_referencia_kg').in('id', ids);
  if (error) {
    if (esObjetoInexistente(error)) return { ok: false, error: MENSAJE_INVENTARIO_NO_HABILITADO, status: 409 };
    logger.error({ evento: 'costos_referencia_no_leidos', userId: actor.userId, motivo: error.message });
    return { ok: false, error: mensajeDeErrorBd(error, 'No se pudieron leer los productos.'), status: 500 };
  }
  const actuales = new Map(((data ?? []) as ProductoCostoRow[]).map(p => [p.id, p]));
  const desconocido = ids.find(id => !actuales.has(id));
  if (desconocido) return { ok: false, error: 'Algún producto no existe.', status: 400 };

  const cambios = entrada.items.filter(i => aNumeroONull(actuales.get(i.productoId)!.costo_referencia_kg) !== i.costoReferenciaKg);
  if (cambios.length === 0) return { ok: true, costos: await obtenerCostosInventario(), cambiados: 0 };

  const { error: errorRpc } = await supabaseAdmin.rpc('actualizar_costos_referencia', {
    p_items: cambios.map(c => ({ producto_id: c.productoId, costo: c.costoReferenciaKg })),
    p_usuario: actor.userId,
  });
  if (errorRpc) {
    if (esObjetoInexistente(errorRpc)) return { ok: false, error: MENSAJE_INVENTARIO_NO_HABILITADO, status: 409 };
    logger.error({ evento: 'costos_referencia_no_guardados', userId: actor.userId, motivo: errorRpc.message });
    return { ok: false, error: mensajeDeErrorBd(errorRpc, 'No se pudieron guardar los costos.'), status: 500 };
  }
  logger.info({ evento: 'costos_referencia_actualizados', userId: actor.userId, productos: cambios.length });

  const auditadas = await Promise.all(
    cambios.map(c =>
      registrarAuditoria({
        entidadTipo: 'producto_costo',
        entidadId: c.productoId,
        accion: 'actualizar',
        usuarioId: actor.userId,
        usuarioEmail: actor.email,
        cambios: { costo_referencia_kg: { antes: aNumeroONull(actuales.get(c.productoId)!.costo_referencia_kg), despues: c.costoReferenciaKg } },
      })
    )
  );
  invalidarCacheResumen();
  return {
    ok: true,
    costos: await obtenerCostosInventario(),
    cambiados: cambios.length,
    ...(auditadas.every(Boolean) ? {} : { advertencia: ADVERTENCIA_AUDITORIA_COSTOS }),
  };
}
