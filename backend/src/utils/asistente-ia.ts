/**
 * Proveedores de IA de texto para el asistente BLOB.
 *
 * Todos hablan el formato OpenAI chat/completions. SIN clave por defecto:
 *   1. llm7.io        (anónimo, modelo "default")
 *   2. Pollinations   (anónimo, modelo "openai")
 * Plan B con clave gratuita (opcional, por variable de entorno):
 *   ASISTENTE_IA_PROVIDER = openai | gemini | groq | openrouter | llm7 | pollinations | auto
 *   ASISTENTE_IA_API_KEY  = clave del proveedor elegido
 *   ASISTENTE_IA_MODEL    = (opcional) sobrescribe el modelo
 * IMPORTANTE: los mensajes del usuario salen a un tercero. Los datos del negocio (resultados de las
 * herramientas de consulta) SOLO se envían al proveedor con `soportaHerramientas` (OpenAI con clave);
 * los anónimos (llm7, Pollinations) nunca los reciben.
 */
import { MAX_TOKENS_SALIDA, MAX_TOKENS_SALIDA_DATOS } from './asistente-limites.js';

export interface MensajeIA {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PeticionIA {
  mensajes: MensajeIA[];
  maxTokens: number;
  timeoutMs: number;
}

/** Mensajes del bucle de herramientas (formato OpenAI chat/completions con tools). */
export interface LlamadaHerramienta {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type MensajeConHerramientas =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: LlamadaHerramienta[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface DefinicionHerramientaIA {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface PeticionConHerramientas {
  mensajes: MensajeConHerramientas[];
  herramientas: DefinicionHerramientaIA[];
  /** true = el modelo debe responder con texto (última ronda). */
  forzarTexto?: boolean;
  maxTokens: number;
  timeoutMs: number;
}

export interface TurnoIA {
  texto: string;
  llamadas: LlamadaHerramienta[];
  tokensEntrada?: number;
  tokensSalida?: number;
}

export interface ProveedorIA {
  nombre: string;
  /** Solo los proveedores de pago de confianza (OpenAI) reciben datos del negocio. */
  soportaHerramientas?: boolean;
  completar(peticion: PeticionIA): Promise<string>;
  conversarConHerramientas?(peticion: PeticionConHerramientas): Promise<TurnoIA>;
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
  /** Habilita function calling (solo OpenAI con clave). */
  herramientas?: boolean;
}

/** Quita bloques de razonamiento que algunos modelos filtran en el contenido. */
export function limpiarRespuesta(texto: string): string {
  return texto.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/** POST a chat/completions con timeout; devuelve el JSON o lanza ('timeout', 'HTTP n'). */
async function publicarChat(
  op: OpcionesCompat,
  fetchFn: FetchFn,
  cuerpo: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (op.apiKey) headers.Authorization = `Bearer ${op.apiKey}`;
    const resp = await fetchFn(op.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: op.modelo, ...cuerpo }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw new Error('timeout');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

interface RespuestaChatCompletions {
  choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Acepta solo tool_calls bien formadas (id, nombre y argumentos como texto). */
function extraerLlamadas(crudo: unknown): LlamadaHerramienta[] {
  if (!Array.isArray(crudo)) return [];
  return crudo.flatMap((c): LlamadaHerramienta[] => {
    const llamada = c as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    const { id, function: fn } = llamada;
    if (typeof id !== 'string' || typeof fn?.name !== 'string') return [];
    return [{ id, type: 'function', function: { name: fn.name, arguments: typeof fn.arguments === 'string' ? fn.arguments : '{}' } }];
  });
}

export function crearProveedorOpenAICompat(op: OpcionesCompat): ProveedorIA {
  const fetchFn: FetchFn = op.fetchFn ?? ((u, i) => fetch(u, i));
  return {
    nombre: op.nombre,
    soportaHerramientas: op.herramientas === true,
    async completar({ mensajes, maxTokens, timeoutMs }) {
      const data = (await publicarChat(
        op,
        fetchFn,
        { messages: mensajes, max_tokens: Math.min(maxTokens, MAX_TOKENS_SALIDA) },
        timeoutMs,
      )) as RespuestaChatCompletions;
      const contenido = data.choices?.[0]?.message?.content;
      const texto = typeof contenido === 'string' ? limpiarRespuesta(contenido) : '';
      if (!texto) throw new Error('respuesta vacía');
      return texto;
    },
    async conversarConHerramientas({ mensajes, herramientas, forzarTexto, maxTokens, timeoutMs }) {
      if (op.herramientas !== true) throw new Error('el proveedor no soporta herramientas');
      const cuerpo: Record<string, unknown> = {
        messages: mensajes,
        max_tokens: Math.min(maxTokens, MAX_TOKENS_SALIDA_DATOS),
      };
      if (herramientas.length > 0) {
        cuerpo.tools = herramientas;
        cuerpo.tool_choice = forzarTexto ? 'none' : 'auto';
      }
      const data = (await publicarChat(op, fetchFn, cuerpo, timeoutMs)) as RespuestaChatCompletions;
      const mensaje = data.choices?.[0]?.message;
      const contenido = mensaje?.content;
      const texto = typeof contenido === 'string' ? limpiarRespuesta(contenido) : '';
      const llamadas = forzarTexto ? [] : extraerLlamadas(mensaje?.tool_calls);
      if (!texto && llamadas.length === 0) throw new Error('respuesta vacía');
      return {
        texto,
        llamadas,
        tokensEntrada: data.usage?.prompt_tokens,
        tokensSalida: data.usage?.completion_tokens,
      };
    },
  };
}

type Env = Record<string, string | undefined>;

const PRESETS_CON_CLAVE: Record<string, { url: string; modelo: string }> = {
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    modelo: 'gemini-2.0-flash',
  },
  // Modelo más barato de OpenAI a propósito: BLOB es una mascota, no necesita más.
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    modelo: 'gpt-4.1-nano',
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
        herramientas: elegido === 'openai',
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
