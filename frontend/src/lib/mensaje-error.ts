/**
 * Traduce cualquier error a un mensaje en español apto para mostrar al usuario.
 * Reglas: los fallos de red y tiempos de espera se explican como falta de conexión; los mensajes que
 * vienen del servidor (ApiError, con `status` numérico) pasan tal cual; el texto técnico (en inglés,
 * de JavaScript o del navegador) nunca se muestra. Sin dependencias para poder probarse aislado.
 */

export const MENSAJE_SIN_CONEXION = 'Sin conexión con el servidor. Revisa tu internet e intenta de nuevo.';
export const MENSAJE_SERVIDOR = 'El servidor tuvo un problema. Intenta de nuevo en unos minutos.';
export const MENSAJE_GENERICO = 'Ocurrió un error inesperado. Intenta de nuevo.';

/** Estados HTTP que indican que no se llegó al servidor (o este no respondió). */
const ESTADOS_SIN_SERVIDOR = new Set([0, 408, 502, 503, 504]);
const PROFUNDIDAD_MAXIMA_CAUSA = 3;

const PATRON_RED = /failed to fetch|load failed|networkerror|network request failed|network error|err_internet|err_network|timed? ?out|timeout|aborted|the operation was aborted|fetch failed/i;
/** Textos típicos de errores de JavaScript/navegador: nunca se le muestran al usuario. */
const PATRON_TECNICO = /\b[a-z]+error\b|cannot read|is not a function|is not defined|undefined|\bnull\b|unexpected token|\bjson\b|\bstack\b|\bat \w+[.(]|\bfetch\b|\bpromise\b/i;
/** Mensaje genérico que arma api-client cuando el servidor no manda texto: "Error 500". */
const PATRON_ERROR_HTTP_VACIO = /^error \d{3}$/i;

export interface OpcionesMensajeError {
  /** Mensaje cuando el error no se puede traducir. */
  porDefecto?: string;
  /** Deja pasar el texto de errores propios de la app (Error simple, ya redactado en español) si no parece técnico. */
  mensajesLocales?: boolean;
}

function estadoHttp(err: unknown): number | null {
  if (!(err instanceof Error)) return null;
  const { status } = err as Error & { status?: unknown };
  return typeof status === 'number' ? status : null;
}

function esFalloDeRed(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { name, message } = err as { name?: unknown; message?: unknown };
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  return typeof message === 'string' && PATRON_RED.test(message);
}

function mensajeDeRespuesta(status: number, mensaje: string, porDefecto: string): string {
  if (ESTADOS_SIN_SERVIDOR.has(status)) return MENSAJE_SIN_CONEXION;
  const limpio = mensaje.trim();
  if (limpio === '' || PATRON_ERROR_HTTP_VACIO.test(limpio)) return status >= 500 ? MENSAJE_SERVIDOR : porDefecto;
  return limpio;
}

function traducir(err: unknown, op: Required<OpcionesMensajeError>, profundidad: number): string {
  const status = estadoHttp(err);
  if (err instanceof Error && status !== null) return mensajeDeRespuesta(status, err.message, op.porDefecto);
  if (esFalloDeRed(err)) return MENSAJE_SIN_CONEXION;
  if (op.mensajesLocales && err instanceof Error) {
    const texto = err.message.trim();
    if (texto !== '' && !PATRON_TECNICO.test(texto)) return texto;
  }
  const causa = err instanceof Error ? (err as Error & { cause?: unknown }).cause : undefined;
  if (causa !== undefined && profundidad < PROFUNDIDAD_MAXIMA_CAUSA) return traducir(causa, op, profundidad + 1);
  return op.porDefecto;
}

/** Mensaje en español para mostrar al usuario a partir de cualquier valor capturado en un catch. */
export function mensajeAmigable(err: unknown, opciones: OpcionesMensajeError = {}): string {
  return traducir(err, { porDefecto: opciones.porDefecto ?? MENSAJE_GENERICO, mensajesLocales: opciones.mensajesLocales ?? false }, 0);
}
