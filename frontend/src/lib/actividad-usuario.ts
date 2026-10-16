/** Rastreo de la actividad del usuario: última vez que escribió/tocó y si hay un
 *  selector de cámara/archivos abierto (la recarga lo cerraría y perdería la foto). */

/** Si el selector no avisa de que se cerró (p. ej. cancelar en algunos Android), se olvida tras este tiempo. */
export const TOPE_SELECTOR_MS = 2 * 60 * 1000;

export interface RastreadorActividad {
  tocar: () => void;
  abrirSelector: () => void;
  cerrarSelector: () => void;
  ultimaInteraccion: () => number;
  selectorAbierto: () => boolean;
}

export function crearRastreadorActividad(ahora: () => number): RastreadorActividad {
  let ultima = ahora();
  let selectorDesde: number | null = null;
  return {
    tocar: () => { ultima = ahora(); },
    abrirSelector: () => { selectorDesde = ahora(); ultima = selectorDesde; },
    cerrarSelector: () => { selectorDesde = null; ultima = ahora(); },
    ultimaInteraccion: () => ultima,
    selectorAbierto: () => selectorDesde !== null && ahora() - selectorDesde < TOPE_SELECTOR_MS,
  };
}

export const rastreadorActividad = crearRastreadorActividad(Date.now);

function esInputArchivo(destino: EventTarget | null): boolean {
  if (!(destino instanceof Element)) return false;
  if (destino.closest('input[type="file"]')) return true;
  const etiqueta = destino.closest('label');
  return Boolean(etiqueta?.querySelector('input[type="file"]'));
}

let instalado = false;

/** Engancha los eventos del documento (una sola vez). */
export function instalarRastreadorActividad(): void {
  if (instalado || typeof document === 'undefined') return;
  instalado = true;
  const r = rastreadorActividad;
  for (const nombre of ['pointerdown', 'keydown', 'input', 'touchstart']) {
    document.addEventListener(nombre, r.tocar, { capture: true, passive: true });
  }
  document.addEventListener('click', e => { if (esInputArchivo(e.target)) r.abrirSelector(); }, true);
  // 'cancel' no burbujea en todos los navegadores: se escucha en captura.
  document.addEventListener('change', e => { if (esInputArchivo(e.target)) r.cerrarSelector(); }, true);
  document.addEventListener('cancel', e => { if (esInputArchivo(e.target)) r.cerrarSelector(); }, true);
}
