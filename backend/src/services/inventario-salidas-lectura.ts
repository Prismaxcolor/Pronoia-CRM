import { supabaseAdmin } from '../config/supabase.js';
import { leerPaginado } from '../utils/paginacion.js';
import { logger } from '../utils/logger.js';
import { esObjetoInexistente } from '../utils/migracion-pendiente.js';
import type { SalidaAlmacenFila } from '../utils/movimientos-almacen.js';

const COLUMNAS_SALIDA = 'producto_id, lote_destino_id, peso_neto';

/** Una consulta paginada de salidas de transformación con la relación embebida que indique `embebido`. */
function consultar(almacenId: string, embebido: string, sinAlmacenPropio: boolean): Promise<SalidaAlmacenFila[]> {
  return leerPaginado<SalidaAlmacenFila>((d, h) => {
    const base = supabaseAdmin.from('transformacion_salida_detalle').select(`${COLUMNAS_SALIDA}, ${embebido}`);
    const filtrada = sinAlmacenPropio
      ? base.is('almacen_id', null).eq('transformaciones.almacen_id', almacenId)
      : base.eq('almacen_id', almacenId);
    return filtrada.order('id').range(d, h);
  });
}

async function leerConEmbebido(almacenId: string, columnasTransformacion: string): Promise<SalidaAlmacenFila[]> {
  const [propias, heredadas] = await Promise.all([
    consultar(almacenId, `transformaciones(${columnasTransformacion})`, false),
    // Salidas sin almacén propio cuya transformación es de este almacén.
    consultar(almacenId, `transformaciones!inner(${columnasTransformacion}, almacen_id)`, true),
  ]);
  return [...propias, ...heredadas];
}

export interface LecturaSalidasAlmacen {
  salidas: SalidaAlmacenFila[];
  /** true = se pidió completado_en pero la columna no existe aún: las salidas se fecharon con la fecha de la transformación. */
  sinCompletadoEn: boolean;
}

/**
 * Salidas de transformación atribuibles a un almacén (propias y heredadas de la transformación).
 * Con `conCompletado` trae además transformaciones.completado_en (para fechar la salida el día en que se
 * completó); si esa columna aún no existe, lee sin ella y la salida se fecha con la fecha de la transformación
 * (`sinCompletadoEn: true`, para que quien muestra el saldo lo avise).
 */
export async function leerSalidasAlmacen(almacenId: string, conCompletado: boolean): Promise<LecturaSalidasAlmacen> {
  if (!conCompletado) return { salidas: await leerConEmbebido(almacenId, 'estado, fecha'), sinCompletadoEn: false };
  try {
    return { salidas: await leerConEmbebido(almacenId, 'estado, fecha, completado_en'), sinCompletadoEn: false };
  } catch (err) {
    if (!esObjetoInexistente(err as { code?: string; message?: string })) throw err;
    logger.warn({ evento: 'salidas_sin_completado_en', motivo: (err as Error).message });
    return { salidas: await leerConEmbebido(almacenId, 'estado, fecha'), sinCompletadoEn: true };
  }
}
