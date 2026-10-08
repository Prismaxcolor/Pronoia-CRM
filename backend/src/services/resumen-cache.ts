import { crearCacheCorto } from '../utils/cache-corto.js';
import type { ResumenInventario } from './inventario-resumen-service.js';

/** Vida de la caché del resumen: lo bastante corta para que nadie vea datos viejos más que un instante. */
export const TTL_CACHE_RESUMEN_MS = 20_000;

/**
 * Caché del resumen de inventario. La clave incluye el permiso de valor (ver inventario-resumen-service),
 * así un usuario sin facturacion:ver nunca recibe el resumen con costos de otro. Los resúmenes parciales
 * o con avisos no se guardan.
 */
export const cacheResumen = crearCacheCorto<ResumenInventario>({
  ttlMs: TTL_CACHE_RESUMEN_MS,
  guardar: r => !r.parcial && r.avisos.length === 0,
});

/** Otras cachés que dependen de lo mismo (la pantalla nueva de inventario) se registran aquí para vaciarse juntas. */
const invalidadoresExtra: Array<() => void> = [];
export function registrarInvalidacionCacheResumen(fn: () => void): void {
  invalidadoresExtra.push(fn);
}

/** Vacía la caché: llamar tras escrituras que cambian lo que el resumen muestra (embalar, clase, precio, configuración). */
export function invalidarCacheResumen(): void {
  cacheResumen.invalidar();
  for (const fn of invalidadoresExtra) fn();
}
