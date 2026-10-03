/**
 * Proveedores de IA de texto para el asistente BLOB.
 *
 * Todos hablan el formato OpenAI chat/completions. SIN clave por defecto:
 *   1. llm7.io        (anónimo, modelo "default")
 *   2. Pollinations   (anónimo, modelo "openai")
 * Plan B con clave gratuita (opcional, por variable de entorno):
 *   ASISTENTE_IA_PROVIDER = gemini | groq | openrouter | llm7 | pollinations | auto
 *   ASISTENTE_IA_API_KEY  = clave del proveedor elegido
 *   ASISTENTE_IA_MODEL    = (opcional) sobrescribe el modelo
 * IMPORTANTE: los mensajes del usuario salen a un tercero. Nunca se envían datos del negocio.
 */
import { MAX_TOKENS_SALIDA } from './asistente-limites.js';

export interface MensajeIA {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PeticionIA {
  mensajes: MensajeIA[];
  maxTokens: number;
  timeoutMs: number;
}

export interface ProveedorIA {
  nombre: string;
  completar(peticion: PeticionIA): Promise<string>;
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export class ErrorIA extends Error {
  readonly causas: string[];
  constructor(mensaje: string, causas: string[] = []) {
    super(mensaje);
    this.name = 'ErrorIA';
    this.causas = causas;
  }
}

interface OpcionesCompat {
  nombre: string;
  url: string;
  modelo: string;
  apiKey?: string;
  fetchFn?: FetchFn;
}

/** Quita bloques de razonamiento que algunos modelos filtran en el contenido. */
export function limpiarRespuesta(texto: string): string {
  return texto.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

export function crearProveedorOpenAICompat(op: OpcionesCompat): ProveedorIA {
  const fetchFn: FetchFn = op.fetchFn ?? ((u, i) => fetch(u, i));
  return {
    nombre: op.nombre,
    async completar({ mensajes, maxTokens, timeoutMs }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (op.apiKey) headers.Authorization = `Bearer ${op.apiKey}`;
        const resp = await fetchFn(op.url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: op.modelo,
            messages: mensajes,
            max_tokens: Math.min(maxTokens, MAX_TOKENS_SALIDA),
          }),
          signal: controller.signal,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = (await resp.json()) as {
          choices?: Array<{ message?: { content?: unknown } }>;
        };
        const contenido = data.choices?.[0]?.message?.content;
        const texto = typeof contenido === 'string' ? limpiarRespuesta(contenido) : '';
        if (!texto) throw new Error('respuesta vacía');
        return texto;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') throw new Error('timeout');
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

type Env = Record<string, string | undefined>;

const PRESETS_CON_CLAVE: Record<string, { url: string; modelo: string }> = {
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    modelo: 'gemini-2.0-flash',
  },
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    modelo: 'llama-3.1-8b-instant',
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    modelo: 'meta-llama/llama-3.3-70b-instruct:free',
  },
};

/** Proveedores sin clave: [llm7, pollinations]. */
export function proveedoresAnonimos(fetchFn?: FetchFn): [ProveedorIA, ProveedorIA] {
  return [
    crearProveedorOpenAICompat({
      nombre: 'llm7',
      url: 'https://api.llm7.io/v1/chat/completions',
      modelo: 'default',
      fetchFn,
    }),
    crearProveedorOpenAICompat({
      nombre: 'pollinations',
      url: 'https://text.pollinations.ai/openai',
      modelo: 'openai',
      fetchFn,
    }),
  ];
}

/**
 * Arma la cadena de proveedores según el entorno. Con clave y proveedor elegido,
 * ese va primero y los anónimos quedan de respaldo. Sin nada configurado: solo anónimos.
 */
export function construirCadenaProveedores(env: Env, fetchFn?: FetchFn): ProveedorIA[] {
  const elegido = (env.ASISTENTE_IA_PROVIDER ?? 'auto').trim().toLowerCase();
  const apiKey = env.ASISTENTE_IA_API_KEY?.trim() || undefined;
  const modelo = env.ASISTENTE_IA_MODEL?.trim() || undefined;
  const [llm7, pollinations] = proveedoresAnonimos(fetchFn);

  const preset = PRESETS_CON_CLAVE[elegido];
  if (preset && apiKey) {
    return [
      crearProveedorOpenAICompat({
        nombre: elegido,
        url: preset.url,
        modelo: modelo || preset.modelo,
        apiKey,
        fetchFn,
      }),
      llm7,
      pollinations,
    ];
  }
  if (elegido === 'llm7') return [llm7];
  if (elegido === 'pollinations') return [pollinations];
  return [llm7, pollinations];
}

/** Prueba cada proveedor en orden; el primero que responda gana. */
export async function completarConRespaldo(
  cadena: ProveedorIA[],
  peticion: PeticionIA,
): Promise<{ texto: string; proveedor: string }> {
  const causas: string[] = [];
  for (const p of cadena) {
    try {
      return { texto: await p.completar(peticion), proveedor: p.nombre };
    } catch (err) {
      causas.push(`${p.nombre}: ${err instanceof Error ? err.message : 'error'}`);
    }
  }
  throw new ErrorIA('Ningún proveedor de IA respondió.', causas);
}
