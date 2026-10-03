import type { AsistenteChatInput, Personalidad } from '../utils/asistente-limites.js';
import { MAX_TOKENS_SALIDA } from '../utils/asistente-limites.js';
import { construirSystemPrompt } from '../utils/asistente-prompt.js';
import {
  completarConRespaldo,
  construirCadenaProveedores,
  ErrorIA,
  type FetchFn,
  type MensajeIA,
  type ProveedorIA,
} from '../utils/asistente-ia.js';
import { logger } from '../utils/logger.js';
import { obtenerSecreto } from '../config/secretos.js';

const CLAVES_IA = ['ASISTENTE_IA_PROVIDER', 'ASISTENTE_IA_API_KEY', 'ASISTENTE_IA_MODEL'] as const;

/** Entorno para construirCadenaProveedores: cada clave sale de env o, si falta, de la tabla de secretos. */
export async function leerEntornoIA(
  leer: (clave: string) => Promise<string | undefined> = obtenerSecreto,
): Promise<Record<string, string | undefined>> {
  const valores = await Promise.all(CLAVES_IA.map(clave => leer(clave)));
  return Object.fromEntries(CLAVES_IA.map((clave, i) => [clave, valores[i]]));
}

/** Vercel Hobby corta a los 10 s: cada proveedor tiene 4,5 s (caben los 2 anónimos). */
export const TIMEOUT_PROVEEDOR_MS = 4500;

export interface RespuestaAsistente {
  respuesta: string;
  /** 'ia' = respondió un proveedor; 'reserva' = frase de reserva local. */
  origen: 'ia' | 'reserva';
}

const RESERVAS: Record<Personalidad, string[]> = {
  amigable: [
    'Uy, se me enredaron los cables y no pude pensar bien. ¿Me lo preguntas otra vez en un ratito?',
    'Mi cerebro de gota se tomó un respiro. Intenta de nuevo en unos segundos.',
  ],
  sarcastico: [
    'Qué mal momento: mi cerebro está "en mantenimiento". Otra vez en un rato, campeón.',
    'La IA no contesta. Yo tampoco la culpo, es lunes en algún lugar del mundo.',
  ],
  formal: [
    'En este momento no puedo procesar su consulta. Por favor, inténtelo nuevamente en unos instantes.',
  ],
  misterioso: [
    'Los espíritus del metal guardan silencio... Vuelve a invocarme en unos instantes.',
  ],
};

export function respuestaDeReserva(personalidad: Personalidad, semilla = Math.random()): string {
  const lista = RESERVAS[personalidad];
  return lista[Math.floor(semilla * lista.length) % lista.length]!;
}

export function armarMensajes(input: AsistenteChatInput): MensajeIA[] {
  return [
    {
      role: 'system',
      content: construirSystemPrompt({
        nombre: input.nombre,
        pagina: input.pagina,
        personalidad: input.personalidad,
      }),
    },
    ...input.historial,
    { role: 'user', content: input.mensaje },
  ];
}

export async function responderChat(
  input: AsistenteChatInput,
  opciones: { cadena?: ProveedorIA[]; userId?: string; fetchFn?: FetchFn } = {},
): Promise<RespuestaAsistente> {
  const cadena = opciones.cadena ?? construirCadenaProveedores(await leerEntornoIA(), opciones.fetchFn);
  try {
    const { texto, proveedor } = await completarConRespaldo(cadena, {
      mensajes: armarMensajes(input),
      maxTokens: MAX_TOKENS_SALIDA,
      timeoutMs: TIMEOUT_PROVEEDOR_MS,
    });
    logger.info({ evento: 'asistente_respuesta', userId: opciones.userId, proveedor });
    return { respuesta: texto, origen: 'ia' };
  } catch (err) {
    logger.warn({
      evento: 'asistente_ia_fallo',
      userId: opciones.userId,
      causas: err instanceof ErrorIA ? err.causas : [String(err)],
    });
    return { respuesta: respuestaDeReserva(input.personalidad), origen: 'reserva' };
  }
}
