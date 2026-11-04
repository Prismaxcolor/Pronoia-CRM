import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { esObjetoInexistente } from '../utils/migracion-pendiente.js';
import { logger } from '../utils/logger.js';
import {
  BUCKET_FOTOS_PACKING,
  VIGENCIA_URL_FOTO_S,
  esRutaFotoPacking,
  rutaNuevaFotoPacking,
  validarArchivoFotoPacking,
} from '../utils/packing-list-fotos.js';

export const MENSAJE_FOTOS_NO_HABILITADAS =
  'Las fotos de paletas aún no están habilitadas en la base de datos (falta aplicar migration_packing_list_lote_fotos.sql).';

export type ResultadoSubidaFoto =
  | { ok: true; ruta: string }
  | { ok: false; error: string; status: 400 | 409 | 500 };

/** Valida la imagen por su firma real y la sube al bucket PRIVADO; devuelve la ruta (no una URL pública). */
export async function subirFotoPacking(buffer: Buffer): Promise<ResultadoSubidaFoto> {
  const archivo = validarArchivoFotoPacking(buffer);
  if (!archivo.ok) return { ok: false, error: archivo.error, status: 400 };
  const ruta = rutaNuevaFotoPacking(randomUUID(), archivo.extension);
  const { error } = await supabaseAdmin.storage.from(BUCKET_FOTOS_PACKING).upload(ruta, buffer, { contentType: archivo.mime });
  if (error) {
    // Bucket inexistente = migración sin aplicar.
    if (/bucket not found/i.test(error.message) || esObjetoInexistente(error)) {
      return { ok: false, error: MENSAJE_FOTOS_NO_HABILITADAS, status: 409 };
    }
    logger.error({ evento: 'packing_foto_no_subida', motivo: error.message });
    return { ok: false, error: 'No se pudo subir la foto. Intenta de nuevo.', status: 500 };
  }
  return { ok: true, ruta };
}

/** URLs firmadas temporales por ruta. Si no se puede firmar, esa ruta queda en null (la foto sigue listada). */
export async function firmarFotosPacking(rutas: readonly string[]): Promise<Map<string, string | null>> {
  const unicas = [...new Set(rutas)];
  const resultado = new Map<string, string | null>(unicas.map(r => [r, null]));
  if (unicas.length === 0) return resultado;
  const { data, error } = await supabaseAdmin.storage.from(BUCKET_FOTOS_PACKING).createSignedUrls(unicas, VIGENCIA_URL_FOTO_S);
  if (error || !data) {
    logger.warn({ evento: 'packing_fotos_sin_firmar', motivo: error?.message ?? 'sin datos' });
    return resultado;
  }
  for (const f of data) {
    if (f.path && f.signedUrl && !f.error) resultado.set(f.path, f.signedUrl);
  }
  return resultado;
}

/** Rutas de fotos guardadas hoy en los ítems de un packing list (vacío si no se pueden leer o falta la migración). */
export async function leerFotosGuardadas(packingListId: string): Promise<string[]> {
  try {
    const { data, error } = await supabaseAdmin.from('packing_list_items').select('fotos').eq('packing_list_id', packingListId);
    if (error || !Array.isArray(data)) return [];
    return [...new Set((data as Array<{ fotos?: string[] | null }>).flatMap(f => f.fotos ?? []))];
  } catch {
    return [];
  }
}

/**
 * Borra del bucket privado las fotos que ya nadie usa (mejor esfuerzo: un fallo solo se registra, nunca rompe el guardado).
 * Criterio: solo se consideran `candidatas` que ANTES estaban guardadas en una paleta y que se quitaron (o cuyo packing list se
 * eliminó), y de ellas únicamente se borran las que NINGUNA fila de packing_list_items sigue referenciando. Las fotos recién
 * subidas que aún no se guardaron (p. ej. en la cola sin conexión) nunca son candidatas: no estaban en ninguna fila.
 */
export async function borrarFotosSinReferencia(candidatas: readonly string[]): Promise<number> {
  const rutas = [...new Set(candidatas)].filter(esRutaFotoPacking);
  if (rutas.length === 0) return 0;
  try {
    const { data, error } = await supabaseAdmin.from('packing_list_items').select('fotos').overlaps('fotos', rutas);
    if (error) {
      logger.warn({ evento: 'packing_fotos_huerfanas_no_verificadas', motivo: error.message });
      return 0;
    }
    const enUso = new Set(((data ?? []) as Array<{ fotos?: string[] | null }>).flatMap(f => f.fotos ?? []));
    const aBorrar = rutas.filter(r => !enUso.has(r));
    if (aBorrar.length === 0) return 0;
    const { error: errBorrado } = await supabaseAdmin.storage.from(BUCKET_FOTOS_PACKING).remove(aBorrar);
    if (errBorrado) {
      logger.warn({ evento: 'packing_fotos_no_borradas', cantidad: aBorrar.length, motivo: errBorrado.message });
      return 0;
    }
    logger.info({ evento: 'packing_fotos_borradas', cantidad: aBorrar.length });
    return aBorrar.length;
  } catch (err) {
    logger.warn({ evento: 'packing_fotos_borrado_fallido', motivo: err instanceof Error ? err.message : String(err) });
    return 0;
  }
}
