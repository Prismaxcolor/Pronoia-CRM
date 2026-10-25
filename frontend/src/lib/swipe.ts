export type DireccionSwipe = 'izquierda' | 'derecha';

/** Distancia horizontal mínima (px) para considerar un gesto como swipe. */
export const UMBRAL_SWIPE_PX = 50;
/** El movimiento horizontal debe superar al vertical por este factor; así un
 *  scroll vertical con deriva lateral no cambia de foto. */
const DOMINANCIA_HORIZONTAL = 1.5;

/**
 * Interpreta un gesto táctil a partir del desplazamiento total (dx, dy).
 * Devuelve la dirección del dedo ('izquierda' = pasar a la siguiente) o null
 * si no alcanza el umbral o es mayormente vertical.
 */
export function detectarSwipe(dx: number, dy: number, umbral: number = UMBRAL_SWIPE_PX): DireccionSwipe | null {
  if (Math.abs(dx) < umbral) return null;
  if (Math.abs(dx) < Math.abs(dy) * DOMINANCIA_HORIZONTAL) return null;
  return dx < 0 ? 'izquierda' : 'derecha';
}
