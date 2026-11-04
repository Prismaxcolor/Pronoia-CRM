/** Política pura de actualización de la app (service worker nuevo en espera).
 *
 *  Regla de oro: actualizar NUNCA destruye datos. Los borradores y la cola
 *  viven en localStorage/IndexedDB y sobreviven a la recarga; aun así la
 *  recarga automática solo ocurre cuando nadie está trabajando. */

/** Tras abrir la app hay unos segundos en que aún no se escribió nada: ahí se
 *  puede aplicar la versión nueva sin molestar. */
export const VENTANA_INICIO_MS = 8000;

export interface DependenciasPolitica {
  /** Cola enviándose / trabajo pendiente de F3 (lib/offline/cola.ts). */
  hayTrabajoEnCurso: () => boolean;
  /** Hay algún formulario con borrador (cambios sin guardar). */
  hayBorradoresActivos: () => boolean;
  /** La app está en segundo plano (pestaña oculta). */
  estaOculta: () => boolean;
  ahora: () => number;
  /** Instante en que cargó la página. */
  inicioEn: number;
}

/** true si es seguro aplicar la versión nueva SIN que el usuario toque nada. */
export function puedeAplicarSola(d: DependenciasPolitica): boolean {
  if (d.hayTrabajoEnCurso() || d.hayBorradoresActivos()) return false;
  return d.estaOculta() || d.ahora() - d.inicioEn < VENTANA_INICIO_MS;
}

/** true si el usuario puede pulsar "Actualizar" ya; si no, se difiere hasta
 *  que termine el envío en curso (la cola no se interrumpe a medias). */
export function puedeAplicarPorClic(d: Pick<DependenciasPolitica, 'hayTrabajoEnCurso'>): boolean {
  return !d.hayTrabajoEnCurso();
}

interface StorageLectura {
  readonly length: number;
  key(indice: number): string | null;
}

export function hayBorradoresEnStorage(storage: StorageLectura | null, prefijo: string): boolean {
  if (!storage) return false;
  try {
    for (let i = 0; i < storage.length; i++) {
      if (storage.key(i)?.startsWith(prefijo)) return true;
    }
    return false;
  } catch {
    // Ante la duda, asumir que hay trabajo: no se recarga sola.
    return true;
  }
}
