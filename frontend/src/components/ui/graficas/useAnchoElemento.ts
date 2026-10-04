import { useEffect, useRef, useState, type RefObject } from 'react';

/** Ancho en píxeles del elemento (se actualiza al redimensionar). Antes de medir devuelve `inicial`. */
export function useAnchoElemento<E extends HTMLElement>(inicial = 320): [RefObject<E | null>, number] {
  const ref = useRef<E>(null);
  const [ancho, setAncho] = useState(inicial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setAncho(Math.max(160, Math.round(el.getBoundingClientRect().width)));
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, ancho];
}
