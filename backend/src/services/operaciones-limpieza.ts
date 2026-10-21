/** Limpieza oportunista de public.operaciones_cliente (docs/migration_operaciones_cliente_limpieza.sql).
 *
 *  La tabla solo sirve para reintentos recientes del teléfono; sin limpieza crecería sin límite.
 *  Al reclamar una operación nueva se lanza, con probabilidad baja y en segundo plano, la función SQL
 *  `limpiar_operaciones_cliente`, que borra por lotes filas 'ok'/'error' de más de 30 días (jamás
 *  'procesando') y se salta sola si otra limpieza ya está corriendo. Nunca bloquea ni rompe la petición. */
import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { ejecutarEnSegundoPlano } from '../utils/segundo-plano.js';

export const PROBABILIDAD_LIMPIEZA = 0.01;

type Azar = () => number;

/** Llama a la limpieza si el azar lo indica. Devuelve true si la lanzó. */
export function limpiezaOportunista(azar: Azar = Math.random, probabilidad = PROBABILIDAD_LIMPIEZA): boolean {
  if (azar() >= probabilidad) return false;
  ejecutarEnSegundoPlano(async () => {
    const { error } = await supabaseAdmin.rpc('limpiar_operaciones_cliente');
    if (error) logger.warn({ evento: 'operaciones_limpieza_fallida', error: error.message });
  }, 'limpiar_operaciones_cliente');
  return true;
}
