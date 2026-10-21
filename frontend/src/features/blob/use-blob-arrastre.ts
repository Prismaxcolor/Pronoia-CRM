import { useRef } from 'react';
import { esquinaMasCercana, type Esquina } from './config';

const UMBRAL_ARRASTRE_PX = 6;
const MARGEN_PX = 16;

/** Coloca el contenedor en una esquina escribiendo las 4 propiedades (limpia restos de un arrastre). */
export function aplicarEsquina(el: HTMLElement, esquina: Esquina): void {
  const arriba = esquina.startsWith('t');
  const izquierda = esquina.endsWith('l');
  el.style.top = arriba ? `${MARGEN_PX}px` : '';
  el.style.bottom = arriba ? '' : `calc(${MARGEN_PX}px + env(safe-area-inset-bottom, 0px))`;
  el.style.left = izquierda ? `${MARGEN_PX}px` : '';
  el.style.right = izquierda ? '' : `${MARGEN_PX}px`;
}

interface Opciones {
  rootRef: React.RefObject<HTMLElement | null>;
  onArrastreInicio: () => void;
  onSoltar: (esquina: Esquina) => void;
  onToque: () => void;
}

/**
 * Distingue toque de arrastre con Pointer Events (ratón y táctil). El movimiento
 * se aplica directo al DOM: no hay re-renders mientras se arrastra.
 */
export function useBlobArrastre({ rootRef, onArrastreInicio, onSoltar, onToque }: Opciones) {
  const sesion = useRef<{ id: number; x0: number; y0: number; left0: number; top0: number; arrastrando: boolean } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !rootRef.current) return;
    const r = rootRef.current.getBoundingClientRect();
    sesion.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, left0: r.left, top0: r.top, arrastrando: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const s = sesion.current;
    const root = rootRef.current;
    if (!s || s.id !== e.pointerId || !root) return;
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    if (!s.arrastrando) {
      if (Math.hypot(dx, dy) < UMBRAL_ARRASTRE_PX) return;
      s.arrastrando = true;
      onArrastreInicio();
      root.style.right = '';
      root.style.bottom = '';
    }
    const maxX = window.innerWidth - root.offsetWidth;
    const maxY = window.innerHeight - root.offsetHeight;
    root.style.left = `${Math.min(Math.max(0, s.left0 + dx), maxX)}px`;
    root.style.top = `${Math.min(Math.max(0, s.top0 + dy), maxY)}px`;
  };

  const terminar = (e: React.PointerEvent<HTMLElement>, cancelado: boolean) => {
    const s = sesion.current;
    const root = rootRef.current;
    if (!s || s.id !== e.pointerId) return;
    sesion.current = null;
    if (s.arrastrando && root) {
      const r = root.getBoundingClientRect();
      const esquina = esquinaMasCercana(r.left + r.width / 2, r.top + r.height / 2, window.innerWidth, window.innerHeight);
      aplicarEsquina(root, esquina);
      onSoltar(esquina);
    } else if (!cancelado) {
      onToque();
    }
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => terminar(e, false),
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => terminar(e, true),
  };
}
