import { z } from 'zod';

/** Límites del endpoint del asistente BLOB. Centralizados para poder testearlos. */
export const MAX_LONGITUD_MENSAJE = 500;
// Topes bajos a propósito: con una clave de pago, cada llamada debe costar fracciones de centavo.
export const MAX_MENSAJES_HISTORIAL = 4;
export const MAX_TOKENS_SALIDA = 150;
/** Con datos de herramientas la respuesta necesita algo más de espacio (cifras, 2-3 líneas). */
export const MAX_TOKENS_SALIDA_DATOS = 350;
/** Rondas máximas de llamadas a herramientas por pregunta (la siguiente llamada ya es solo texto). */
export const MAX_RONDAS_HERRAMIENTAS = 3;
/** Llamadas a herramientas que se ejecutan por ronda; las demás se rechazan. */
export const MAX_LLAMADAS_POR_RONDA = 4;
export const MAX_LONGITUD_NOMBRE = 30;
export const LIMITE_PETICIONES_POR_MINUTO = 8;
/** Tope diario por usuario (una pregunta = una petición a /chat), persistido en Supabase. */
export const LIMITE_PREGUNTAS_DIARIAS = 60;

export const PERSONALIDADES = ['amigable', 'sarcastico', 'formal', 'misterioso'] as const;
export type Personalidad = (typeof PERSONALIDADES)[number];

/** Páginas que el frontend puede declarar. Cualquier otra cosa se trata como 'otra'. */
export const PAGINAS_ASISTENTE = [
  'inicio', 'metricas', 'pesaje', 'compras', 'ventas', 'inventario', 'transformaciones',
  'productos', 'listas-precios', 'taras', 'vehiculos', 'clientes', 'proveedores',
  'cochinito', 'usuarios', 'citas', 'configuracion', 'otra',
] as const;
export type PaginaAsistente = (typeof PAGINAS_ASISTENTE)[number];

/**
 * Deja solo el nombre de pila: primera palabra, sin símbolos raros, tope de largo.
 * Evita que el campo sirva para colar instrucciones al system prompt.
 */
export function nombrePila(raw: string | undefined | null): string {
  if (!raw) return '';
  const primera = raw.trim().split(/\s+/)[0] ?? '';
  return primera.replace(/[^\p{L}\p{N}'-]/gu, '').slice(0, MAX_LONGITUD_NOMBRE);
}

const mensajeSchema = z.object({
  role: z.enum(['user', 'assistant']),
  /** El frontend marca las respuestas de BLOB que incluyeron datos consultados del sistema. */
  datos: z.boolean().optional(),
  // Se recorta (no se rechaza): una respuesta previa de la IA puede ser más larga que el límite.
  content: z.string().trim().min(1).transform(c => c.slice(0, MAX_LONGITUD_MENSAJE)),
});

export const asistenteChatSchema = z.object({
  mensaje: z.string().trim().min(1, 'Escribe algo.').max(MAX_LONGITUD_MENSAJE, `Máximo ${MAX_LONGITUD_MENSAJE} caracteres.`),
  /** Turnos previos de ESTA conversación (solo texto del chat). Se recortan a los últimos N. */
  historial: z
    .array(mensajeSchema)
    .max(40)
    .optional()
    .transform(h => (h ?? []).slice(-MAX_MENSAJES_HISTORIAL)),
  nombre: z.string().max(100).optional().transform(n => nombrePila(n)),
  pagina: z
    .string()
    .max(40)
    .optional()
    .transform((p): PaginaAsistente =>
      (PAGINAS_ASISTENTE as readonly string[]).includes(p ?? '') ? (p as PaginaAsistente) : 'otra'),
  personalidad: z.enum(PERSONALIDADES).optional().default('amigable'),
  /** Interruptor del usuario: false = BLOB no consulta datos (no se ofrecen herramientas). */
  consultarDatos: z.boolean().optional().default(true),
});

export type AsistenteChatInput = z.infer<typeof asistenteChatSchema>;
