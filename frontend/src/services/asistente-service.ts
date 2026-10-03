import { apiFetch, ApiError } from './api-client';

export interface MensajeChat {
  role: 'user' | 'assistant';
  content: string;
}

export interface PeticionChat {
  mensaje: string;
  historial: MensajeChat[];
  nombre: string;
  pagina: string;
  personalidad: string;
}

export interface RespuestaChat {
  respuesta: string;
  /** 'reserva' = la IA no respondió y BLOB usó una frase local. */
  origen: 'ia' | 'reserva';
}

/** Llama al backend (nunca directo a la IA). Nunca lanza: devuelve texto amable si falla. */
export async function enviarMensajeAsistente(p: PeticionChat): Promise<RespuestaChat> {
  try {
    return await apiFetch<RespuestaChat>('/api/asistente/chat', { method: 'POST', body: p });
  } catch (err) {
    if (err instanceof ApiError && err.status === 429) {
      return { respuesta: 'Voy muy rápido para ti. Dame un minuto para respirar y vuelve a preguntarme.', origen: 'reserva' };
    }
    return { respuesta: 'No pude conectarme ahora mismo. Intenta de nuevo en un momento.', origen: 'reserva' };
  }
}
