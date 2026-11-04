/**
 * Almacén de las salidas a LOTE de una transformación. El lote no fija un
 * almacén por sí mismo (su stock puede estar repartido en varios), así que el
 * formulario ya no lo pregunta: la salida queda en el almacén de la
 * transformación o, si esta no tiene (transformaciones antiguas), en el
 * predeterminado. Una salida que SÍ trae almacén (API/cliente anterior) lo conserva.
 */

export type ResultadoAlmacenSalidas<T> = { ok: true; salidas: T[] } | { ok: false; error: string };

export const MENSAJE_SIN_ALMACEN_SALIDA =
  'No se pudo determinar el almacén de las salidas a lote: la transformación no tiene almacén ni hay un almacén predeterminado.';

/** Devuelve copias de las salidas con almacenId completado (solo las que `aplica` y no traen almacén). No muta la entrada. */
export function completarAlmacenSalidas<T extends { almacenId?: string | null }>(
  salidas: ReadonlyArray<T>,
  almacenDefaultId: string | null,
  aplica: (salida: T) => boolean
): ResultadoAlmacenSalidas<T> {
  const necesitaDefault = salidas.some(s => aplica(s) && !s.almacenId);
  if (necesitaDefault && !almacenDefaultId) return { ok: false, error: MENSAJE_SIN_ALMACEN_SALIDA };
  return {
    ok: true,
    salidas: salidas.map(s => (aplica(s) && !s.almacenId ? { ...s, almacenId: almacenDefaultId } : { ...s })),
  };
}
