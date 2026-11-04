/** ¿Es seguro recargar la app SOLA (sin que el usuario lo pida)?
 *  Regla de oro: nunca se interrumpe lo que el usuario esté haciendo. */

/** Sin tocar ni escribir durante este tiempo, el usuario se considera inactivo. */
export const INACTIVIDAD_SEGURA_MS = 60_000;

export interface EntornoSeguro {
  /** Operación de la cola enviándose (cola.ts). */
  hayTrabajoEnCurso: () => boolean;
  hayFotosSubiendo: () => boolean;
  /** Envío de formulario / petición que escribe en vuelo. */
  hayEnvioEnVuelo: () => boolean;
  /** Modal o formulario con cambios sin enviar. */
  hayBorradorSucio: () => boolean;
  /** Selector de cámara/archivos abierto. */
  selectorArchivosAbierto: () => boolean;
  /** La app está en segundo plano (el usuario no la está tocando). */
  estaOculta: () => boolean;
  ultimaInteraccion: () => number;
  ahora: () => number;
}

/** true si hay trabajo que una recarga podría cortar (también hace esperar al botón manual). */
export function hayTrabajoActivo(e: Pick<EntornoSeguro, 'hayTrabajoEnCurso' | 'hayFotosSubiendo' | 'hayEnvioEnVuelo'>): boolean {
  return e.hayTrabajoEnCurso() || e.hayFotosSubiendo() || e.hayEnvioEnVuelo();
}

export function esMomentoSeguro(e: EntornoSeguro): boolean {
  if (hayTrabajoActivo(e)) return false;
  if (e.hayBorradorSucio() || e.selectorArchivosAbierto()) return false;
  if (e.estaOculta()) return true;
  return e.ahora() - e.ultimaInteraccion() >= INACTIVIDAD_SEGURA_MS;
}
