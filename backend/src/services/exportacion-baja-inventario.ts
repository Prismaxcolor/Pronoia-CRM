import { supabaseAdmin } from '../config/supabase.js';
import { esObjetoInexistente } from '../utils/migracion-pendiente.js';
import { logger } from '../utils/logger.js';

export const AVISO_BAJA_NO_HABILITADA =
  'La exportación se guardó, pero el inventario NO se descontó: falta aplicar migration_exportacion_baja_inventario.sql.';
export const AVISO_BAJA_FALLIDA =
  'La exportación se guardó, pero no se pudo descontar el inventario. Avisa al administrador: guardar de nuevo no lo reintenta.';

interface LoteDadoDeBaja {
  lote: string;
  almacen_id: string | null;
  kg: number | string;
  exceso_kg: number | string;
}

export interface RespuestaBajaExportacion {
  ya_registrada: boolean;
  lotes: LoteDadoDeBaja[];
  sin_lote: string[];
}

const formatoKg = (n: number) => `${n.toLocaleString('es-VE', { maximumFractionDigits: 2 })} kg`;

/** Texto para el usuario si la baja dejó algo por revisar (lotes sin inventario o stock insuficiente); null si salió limpia. */
export function avisoDeBaja(r: RespuestaBajaExportacion): string | null {
  const avisos: string[] = [];
  if (r.sin_lote.length > 0) {
    avisos.push(`Estos lotes no existen en el inventario y no se descontaron: ${r.sin_lote.join(', ')}.`);
  }
  const excesos = new Map<string, number>();
  for (const l of r.lotes) {
    const exceso = Number(l.exceso_kg);
    if (exceso > 0) excesos.set(l.lote, (excesos.get(l.lote) ?? 0) + exceso);
  }
  if (excesos.size > 0) {
    const detalle = [...excesos].map(([lote, kg]) => `${lote} (${formatoKg(kg)})`).join(', ');
    avisos.push(`El stock no alcanzaba y el inventario quedó en negativo en: ${detalle}.`);
  }
  return avisos.length > 0 ? avisos.join(' ') : null;
}

/**
 * ¿El packing list ya era una exportación (tiene cliente) antes de este guardado? La baja ocurre una sola vez, al
 * asignar el cliente: volver a guardar una exportación vieja no debe descontar material que ya salió. Ante un fallo
 * de lectura responde true (no descontar) en vez de arriesgar un doble descuento.
 */
export async function yaEraExportacion(packingListId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from('packing_lists').select('cliente_id').eq('id', packingListId).maybeSingle();
  if (error) {
    logger.warn({ evento: 'exportacion_cliente_previo_no_leido', packingListId, motivo: error.message });
    return true;
  }
  return Boolean((data as { cliente_id?: string | null } | null)?.cliente_id);
}

/**
 * Da de baja del inventario el material del packing list (ajuste negativo por lote y almacén). Idempotente en la BD:
 * guardar de nuevo no descuenta dos veces. NUNCA lanza: el packing list ya está guardado, así que un fallo se
 * devuelve como aviso para mostrarlo, no como error de guardado.
 */
export async function darBajaExportacion(packingListId: string, userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc('dar_baja_exportacion', { p_packing_list_id: packingListId, p_usuario_id: userId });
  if (error || !data) {
    logger.error({ evento: 'exportacion_baja_inventario_fallida', packingListId, motivo: error?.message ?? 'sin respuesta' });
    return error && esObjetoInexistente(error) ? AVISO_BAJA_NO_HABILITADA : AVISO_BAJA_FALLIDA;
  }
  const parcial = data as Partial<RespuestaBajaExportacion>;
  const respuesta: RespuestaBajaExportacion = { ya_registrada: parcial.ya_registrada === true, lotes: parcial.lotes ?? [], sin_lote: parcial.sin_lote ?? [] };
  if (!respuesta.ya_registrada) {
    logger.info({ evento: 'exportacion_baja_inventario', packingListId, userId, lotes: respuesta.lotes.length });
  }
  return avisoDeBaja(respuesta);
}
