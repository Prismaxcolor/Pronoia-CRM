import { useRef, type TouchEvent } from 'react';
import { detectarSwipe, type DireccionSwipe } from '../lib/swipe';

interface Punto { x: number; y: number }

interface SwipeHandlers {
  onTouchStart: (e: TouchEvent) => void;
  onTouchEnd: (e: TouchEvent) => void;
  onTouchCancel: () => void;
}

/**
 * Detecta deslizamientos horizontales con un dedo. No interfiere con los
 * clics ni con las flechas: solo observa touchstart/touchend y descarta
 * gestos multitáctil (pellizco/zoom) y los mayormente verticales.
 */
export function useSwipe(onSwipe: (direccion: DireccionSwipe) => void): SwipeHandlers {
  const inicio = useRef<Punto | null>(null);

  return {
    onTouchStart: e => {
      if (e.touches.length !== 1) {
        inicio.current = null;
        return;
      }
      inicio.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    },
    onTouchEnd: e => {
      const desde = inicio.current;
      inicio.current = null;
      const toque = e.changedTouches[0];
      if (!desde || !toque) return;
      const direccion = detectarSwipe(toque.clientX - desde.x, toque.clientY - desde.y);
      if (direccion) onSwipe(direccion);
    },
    onTouchCancel: () => {
      inicio.current = null;
    },
  };
}
