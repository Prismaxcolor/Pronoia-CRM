import { useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { useAnchoElemento } from '../../../components/ui/graficas/useAnchoElemento';
import { esTeclaDeCursor, indiceBajoCursor, indiceTrasTecla } from './estadisticas-curvas';

export interface CursorGrafica {
  /** Contenedor de la gráfica (mide su ancho en píxeles). */
  ref: RefObject<HTMLDivElement | null>;
  /** Píxeles por unidad del viewBox (la gráfica escala con el ancho disponible). */
  escala: number;
  /** Punto activo (cursor, toque o teclado); null = ninguno. */
  indice: number | null;
  manejadores: {
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
    onPointerLeave: (e: PointerEvent<HTMLDivElement>) => void;
    onBlur: () => void;
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  };
}

/** Cursor de una gráfica: ratón y toque eligen el punto más cercano; las flechas izquierda y derecha lo recorren (arriba y abajo
 *  siguen desplazando la página); Escape lo quita.
 *  `xs` son las posiciones de los puntos en unidades del viewBox. */
export function useCursorGrafica(xs: readonly number[], anchoVista: number): CursorGrafica {
  const [ref, ancho] = useAnchoElemento<HTMLDivElement>(anchoVista);
  const [bruto, setIndice] = useState<number | null>(null);
  const indice = bruto !== null && bruto < xs.length ? bruto : null;
  const escala = ancho / anchoVista;
  const desdePuntero = (e: PointerEvent<HTMLDivElement>): void => {
    const caja = e.currentTarget.getBoundingClientRect();
    if (caja.width > 0) setIndice(indiceBajoCursor(xs, ((e.clientX - caja.left) / caja.width) * anchoVista));
  };
  return {
    ref,
    escala,
    indice,
    manejadores: {
      onPointerMove: desdePuntero,
      onPointerDown: desdePuntero,
      onPointerLeave: e => { if (e.pointerType === 'mouse') setIndice(null); },
      onBlur: () => setIndice(null),
      onKeyDown: e => {
        if (!esTeclaDeCursor(e.key)) return;
        e.preventDefault();
        setIndice(indiceTrasTecla(indice, e.key, xs.length));
      },
    },
  };
}
