import { supabaseAdmin } from '../config/supabase.js';
import { esObjetoInexistente } from '../utils/migracion-pendiente.js';
import { esProductoDesechos, leerVaciados, sumarKg, type VaciadoAlmacen } from '../utils/desechos.js';
import { invalidarCacheResumen } from './resumen-cache.js';
import { logger } from '../utils/logger.js';

export type ResultadoVaciado =
  | { ok: true; kgVaciados: number; almacenes: VaciadoAlmacen[] }
  | { ok: false; status: number; error: string };

const MENSAJE_SIN_MIGRACION =
  'Vaciar desechos aún no está habilitado en la base de datos (falta aplicar migration_vaciar_desechos.sql).';

/** Deja el producto DESECHOS en 0 kg en todos los almacenes (un ajuste por almacén con quién,
 *  cuándo y cuántos kg). Solo acepta ese producto: cualquier otro se rechaza aquí y en el RPC. */
export async function vaciarDesechos(productoId: string, usuarioId: string): Promise<ResultadoVaciado> {
  const { data: producto, error: errorProducto } = await supabaseAdmin
    .from('productos')
    .select('id, nombre')
    .eq('id', productoId)
    .maybeSingle();
  if (errorProducto) return { ok: false, status: 500, error: 'No se pudo leer el producto.' };
  if (!producto) return { ok: false, status: 404, error: 'Producto no encontrado.' };
  if (!esProductoDesechos(producto.nombre as string)) {
    return { ok: false, status: 400, error: 'Solo el producto DESECHOS se puede vaciar.' };
  }

  const { data, error } = await supabaseAdmin.rpc('vaciar_desechos', {
    p_producto_id: productoId,
    p_usuario_id: usuarioId,
  });
  if (error) {
    if (esObjetoInexistente(error)) return { ok: false, status: 409, error: MENSAJE_SIN_MIGRACION };
    return { ok: false, status: 400, error: error.message };
  }

  const almacenes = leerVaciados(data);
  if (almacenes.length === 0) return { ok: false, status: 400, error: 'No hay desechos en el inventario para vaciar.' };
  invalidarCacheResumen();
  const kgVaciados = sumarKg(almacenes);
  logger.info({ evento: 'desechos_vaciados', userId: usuarioId, productoId, kgVaciados, almacenes: almacenes.length });
  return { ok: true, kgVaciados, almacenes };
}
