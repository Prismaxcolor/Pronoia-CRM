/**
 * Máquina de estados de ánimo de BLOB. Lógica pura (sin DOM ni React) para poder
 * testearla: el componente solo traduce eventos del navegador a estos eventos.
 */
export type Animo = 'normal' | 'feliz' | 'sorprendido' | 'risa' | 'enojado' | 'mareado' | 'dormido';

export interface EstadoAnimo {
  animo: Animo;
  /** Instante (ms) en que el ánimo temporal expira; null si es estable (normal/dormido). */
  hasta: number | null;
  /** Instantes de los toques recientes (ventana deslizante). */
  toques: number[];
  ultimaActividad: number;
}

export type EventoAnimo = { tipo: 'toque' } | { tipo: 'actividad' } | { tipo: 'tick' };

export const VENTANA_TOQUES_MS = 2500;
export const INACTIVIDAD_DEFECTO_MS = 60_000;

export const DURACION_ANIMO_MS: Record<Exclude<Animo, 'normal' | 'dormido'>, number> = {
  feliz: 1200,
  sorprendido: 900,
  risa: 2000,
  enojado: 2500,
  mareado: 3000,
};

export function estadoInicial(ahora: number): EstadoAnimo {
  return { animo: 'normal', hasta: null, toques: [], ultimaActividad: ahora };
}

/** Ánimo que provoca el n-ésimo toque seguido dentro de la ventana. */
export function animoPorToques(n: number): Exclude<Animo, 'normal' | 'dormido'> {
  if (n <= 1) return 'feliz';
  if (n === 2) return 'sorprendido';
  if (n <= 4) return 'risa';
  if (n <= 6) return 'enojado';
  return 'mareado';
}

export function reducirAnimo(
  estado: EstadoAnimo,
  evento: EventoAnimo,
  ahora: number,
  inactividadMs: number = INACTIVIDAD_DEFECTO_MS,
): EstadoAnimo {
  switch (evento.tipo) {
    case 'toque': {
      if (estado.animo === 'dormido') {
        return {
          animo: 'sorprendido',
          hasta: ahora + DURACION_ANIMO_MS.sorprendido,
          toques: [ahora],
          ultimaActividad: ahora,
        };
      }
      const toques = [...estado.toques.filter(t => ahora - t <= VENTANA_TOQUES_MS), ahora];
      const animo = animoPorToques(toques.length);
      return { animo, hasta: ahora + DURACION_ANIMO_MS[animo], toques, ultimaActividad: ahora };
    }
    case 'actividad': {
      if (estado.animo === 'dormido') {
        return {
          ...estado,
          animo: 'sorprendido',
          hasta: ahora + DURACION_ANIMO_MS.sorprendido,
          ultimaActividad: ahora,
        };
      }
      return { ...estado, ultimaActividad: ahora };
    }
    case 'tick': {
      if (estado.hasta !== null && ahora >= estado.hasta) {
        return { ...estado, animo: 'normal', hasta: null };
      }
      if (estado.animo === 'normal' && ahora - estado.ultimaActividad >= inactividadMs) {
        return { ...estado, animo: 'dormido', hasta: null };
      }
      return estado;
    }
  }
}
