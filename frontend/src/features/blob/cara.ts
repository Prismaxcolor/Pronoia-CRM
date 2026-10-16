/**
 * Semilla y expresiones de BLOB sobre la librería `blobatar`. La librería genera
 * silueta, colores y rasgos de fábrica a partir del `name`; aquí solo se decide qué
 * nombre usar y qué pose de la librería corresponde a cada ánimo. Lógica pura.
 */
import type { Animo } from './animo';

export type NombreExpresion =
  | 'idle' | 'happy' | 'sad' | 'mad' | 'surprised' | 'wink' | 'sleepy'
  | 'smug' | 'unsure' | 'scared' | 'love' | 'shy' | 'sick' | 'thinking';

const SEMILLA_RESERVA = 'pronoia';

/**
 * Semilla del aspecto físico: depende SOLO del usuario logueado (nombre; si no hay,
 * su email; si tampoco, una reserva estable). No lee ninguna configuración guardada.
 */
export function semillaBlob(usuario: { nombre?: string; email?: string } | null | undefined): string {
  return usuario?.nombre?.trim() || usuario?.email?.trim() || SEMILLA_RESERVA;
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
