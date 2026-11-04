/** Lógica pura de la pila de modales abiertos (sin DOM): quién reacciona a Escape, cuándo bloquear el scroll y a dónde va el foco con Tab. */

export type PilaModales = readonly string[];

export function apilar(pila: PilaModales, id: string): PilaModales {
  return pila.includes(id) ? pila : [...pila, id];
}

export function desapilar(pila: PilaModales, id: string): PilaModales {
  return pila.filter(x => x !== id);
}

/** Solo el modal de más arriba reacciona a Escape. */
export function esSuperior(pila: PilaModales, id: string): boolean {
  return pila.length > 0 && pila[pila.length - 1] === id;
}

export type AccionScroll = 'bloquear' | 'liberar' | null;

/** El scroll del body se bloquea al abrir el primer modal y se libera al cerrar el último. */
export function accionScroll(abiertosAntes: number, abiertosDespues: number): AccionScroll {
  if (abiertosAntes === 0 && abiertosDespues > 0) return 'bloquear';
  if (abiertosAntes > 0 && abiertosDespues === 0) return 'liberar';
  return null;
}

/**
 * Trampa de foco: índice (entre los `total` enfocables del modal) al que saltar con Tab / Shift+Tab,
 * o null si el navegador puede seguir su orden normal. `actual` es -1 si el foco está fuera de los enfocables.
 */
export function destinoTab(total: number, actual: number, atras: boolean): number | null {
  if (total <= 0) return null;
  if (actual < 0) return atras ? total - 1 : 0;
  if (!atras && actual === total - 1) return 0;
  if (atras && actual === 0) return total - 1;
  return null;
}
