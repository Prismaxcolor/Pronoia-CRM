import { createContext } from 'react';

export interface DatosCompartir {
  /** "ÚLTIMOS 30 DÍAS · 13/10/2026 al 11/11/2026". */
  rotuloPeriodo: string;
  /** Cambia cuando cambia lo que la tarjeta muestra por fuera de sus propios datos (período, ocultar cantidades):
   *  reinicia el botón (y su imagen precalculada), para que nunca se comparta una imagen vieja (p. ej. con montos que ya se ocultaron). */
  huella: string;
}

/** Lo que la pantalla de Estadísticas reparte a las tarjetas para que cada una pueda compartirse como imagen.
 *  null = fuera de esa pantalla: la tarjeta no muestra el botón. */
export const CompartirContext = createContext<DatosCompartir | null>(null);
