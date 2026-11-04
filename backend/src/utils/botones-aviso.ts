/** Botón de enlace (solo https) bajo un aviso de Telegram. */
export interface BotonUrl {
  texto: string;
  url: string;
}

/** Botón de acción: Telegram devuelve `callback` a n8n al tocarlo (≤ 64 bytes, patrón "llave:a:<uuid>"). */
export interface BotonCallback {
  texto: string;
  callback: string;
}

/** Botones que acompañan un aviso de Telegram (los pinta el flujo n8n). */
export type BotonAviso = BotonUrl | BotonCallback;

const MAX_BOTONES = 3;
const MAX_TEXTO_BOTON = 64;
/** Límite de Telegram para callback_data. */
const MAX_BYTES_CALLBACK = 64;
const PATRON_CALLBACK = /^[a-z]+:[a-z]:[0-9a-fA-F-]{1,40}$/;

function validarUno(b: unknown): BotonAviso | null {
  if (!b || typeof b !== 'object') return null;
  const { texto, url, callback } = b as { texto?: unknown; url?: unknown; callback?: unknown };
  if (typeof texto !== 'string') return null;
  const textoLimpio = texto.trim().slice(0, MAX_TEXTO_BOTON);
  if (!textoLimpio) return null;

  if (typeof callback === 'string' && url === undefined) {
    const dato = callback.trim();
    if (Buffer.byteLength(dato, 'utf8') > MAX_BYTES_CALLBACK || !PATRON_CALLBACK.test(dato)) return null;
    return { texto: textoLimpio, callback: dato };
  }
  if (typeof url !== 'string' || callback !== undefined) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:' ? { texto: textoLimpio, url: u.toString() } : null;
  } catch {
    return null;
  }
}

/** Deja solo los botones válidos (texto no vacío y URL https o callback con el patrón permitido). Nunca lanza; devuelve [] si no hay ninguno. */
export function validarBotones(botones: unknown): BotonAviso[] {
  if (!Array.isArray(botones)) return [];
  const validos: BotonAviso[] = [];
  for (const b of botones) {
    const valido = validarUno(b);
    if (valido) validos.push(valido);
  }
  return validos.slice(0, MAX_BOTONES);
}
