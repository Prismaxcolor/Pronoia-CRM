/**
 * Semilla y expresiones de BLOB sobre la librería `blobatar`. La librería genera
 * silueta, colores y rasgos de fábrica a partir del `name`; aquí solo se decide qué
 * nombre usar y qué pose de la librería corresponde a cada ánimo. Lógica pura.
 */
import type { Animo } from './animo';
import type { BlobConfig } from './config';

export type NombreExpresion =
  | 'idle' | 'happy' | 'sad' | 'mad' | 'surprised' | 'wink' | 'sleepy'
  | 'smug' | 'unsure' | 'scared' | 'love' | 'shy' | 'sick' | 'thinking';

export const MAX_SEMILLA = 40;
const SEMILLA_RESERVA = 'pronoia';

/** Semilla: la propia si la hay; si no, el nombre del usuario logueado; si no, una reserva estable. */
export function semillaBlob(config: Pick<BlobConfig, 'semilla'>, nombreUsuario: string | undefined): string {
  return config.semilla.trim() || nombreUsuario?.trim() || SEMILLA_RESERVA;
}

/** Semilla nueva para "Probar otro". `azar` inyectable para testear. */
export function semillaAleatoria(azar: () => number = Math.random): string {
  return azar().toString(36).slice(2, 10) || 'x';
}

/** Expresión de la librería para cada ánimo. `pensando` = esperando respuesta de la IA. */
export function expresionPorAnimo(animo: Animo, pensando: boolean): NombreExpresion {
  switch (animo) {
    case 'feliz': return 'happy';
    case 'risa': return 'happy';
    case 'sorprendido': return 'surprised';
    case 'enojado': return 'mad';
    case 'mareado': return 'sick';
    case 'dormido': return 'sleepy';
    case 'normal': return pensando ? 'thinking' : 'idle';
  }
}
