import { apiFetch, ApiError } from './api-client';

export interface MensajeChat {
  role: 'user' | 'assistant';
  content: string;
  /** Solo respuestas de BLOB: qué consultó del sistema ("inventario", "facturas"...). */
  consultas?: string[];
}

/** Lo que viaja al backend por cada mensaje previo (sin la lista de consultas). */
export interface MensajeHistorial {
  role: 'user' | 'assistant';
  content: string;
  /** true = esta respuesta incluyó datos consultados del sistema. */
  datos?: boolean;
}

export function aHistorial(mensajes: MensajeChat[]): MensajeHistorial[] {
  return mensajes.map(m => ({
    role: m.role,
    content: m.content,
    ...(m.consultas && m.consultas.length > 0 ? { datos: true } : {}),
  }));
}

export interface PeticionChat {
  mensaje: string;
  historial: MensajeHistorial[];
  nombre: string;
  pagina: string;
  personalidad: string;
  /** Interruptor del usuario: false = BLOB no consulta datos. */
  consultarDatos: boolean;
}

export interface RespuestaChat {
  respuesta: string;
  /** 'reserva' = la IA no respondió y BLOB usó una frase local. */
  origen: 'ia' | 'reserva';
  /** 'datos' = pudo consultar el sistema en esta respuesta; 'charla' = sin acceso a datos. */
  modo: 'datos' | 'charla';
  /** Qué consultó de verdad, para mostrarlo ("Consulté: inventario"). */
  consultas: string[];
}

/** Llama al backend (nunca directo a la IA). Nunca lanza: devuelve texto amable si falla. */
export async function enviarMensajeAsistente(p: PeticionChat): Promise<RespuestaChat> {
  try {
    return await apiFetch<RespuestaChat>('/api/asistente/chat', { method: 'POST', body: p });
  } catch (err) {
    // 401 (usuario inactivo), 429 (límite por minuto o diario) y 503 traen un mensaje claro del servidor.
    if (err instanceof ApiError && [401, 429, 503].includes(err.status) && err.message) {
      return { respuesta: err.message, origen: 'reserva', modo: 'charla', consultas: [] };
    }
    return { respuesta: 'No pude conectarme ahora mismo. Intenta de nuevo en un momento.', origen: 'reserva', modo: 'charla', consultas: [] };
  }
}
