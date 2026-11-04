/**
 * Piezas comunes de las herramientas de consulta de BLOB: tipos, saneo de texto,
 * topes de tamaño y fechas.
 *
 * PRIVACIDAD: todo lo que devuelve una herramienta se envía al proveedor de IA externo
 * (OpenAI) para redactar la respuesta. Por eso cada herramienta devuelve solo campos
 * mínimos y seguros: nunca contraseñas, hashes, tokens, números de cuenta, cédulas/RIF,
 * teléfonos, chat ids de Telegram, llaves de edición ni notas internas.
 */
import { z } from 'zod';
import type { Permiso } from './permisos.js';

/** Filas máximas que una herramienta puede devolver (tope duro, aunque el modelo pida más). */
export const MAX_FILAS_HERRAMIENTA = 15;
export const FILAS_POR_DEFECTO = 10;
/** Tope de caracteres del resultado serializado que se entrega al modelo (controla el costo). */
export const MAX_CHARS_RESULTADO = 3500;
export const MAX_LONGITUD_TEXTO = 60;
/** Zona horaria de la operación (misma que usa el aviso al grupo). */
export const ZONA_HORARIA = 'America/Caracas';

export interface ContextoHerramienta {
  userId: string;
  /** Hoy (YYYY-MM-DD) en la zona horaria de la operación. */
  hoy: string;
  /** ¿Esta persona cumple el permiso? (para herramientas que consultan según lo que puede ver). */
  puede: (permiso: Permiso) => boolean;
}

export interface ResultadoHerramienta {
  /** Cantidad de filas/registros devueltos (para la auditoría; no se registra el contenido). */
  filas: number;
  datos: unknown;
  /** Sustituye la etiqueta fija de la herramienta en "Consulté: ..." (según lo que se consultó de verdad). */
  etiqueta?: string;
}

export interface HerramientaAsistente {
  nombre: string;
  /** Etiqueta corta que ve el usuario en el chat: "Consulté: inventario". */
  etiqueta: string;
  /** Descripción para el modelo. */
  descripcion: string;
  /** Esquema zod de los parámetros (se convierte a JSON Schema para OpenAI y valida la llamada). */
  parametros: z.ZodType;
  /** TODOS estos permisos son obligatorios (siempre acción 'ver': las herramientas son de solo lectura). */
  permisos: readonly Permiso[];
  /** Además de `permisos`, basta UNO de estos (p. ej. proveedores o clientes). La herramienta decide qué consulta según `ctx.puede`. */
  permisosAlguno?: readonly Permiso[];
  ejecutar: (args: unknown, ctx: ContextoHerramienta) => Promise<ResultadoHerramienta>;
}

export interface DefinicionHerramienta<S extends z.ZodType> {
  nombre: string;
  etiqueta: string;
  descripcion: string;
  parametros: S;
  permisos: readonly Permiso[];
  permisosAlguno?: readonly Permiso[];
  ejecutar: (args: z.output<S>, ctx: ContextoHerramienta) => Promise<ResultadoHerramienta>;
}

/** Crea una herramienta tipada; los argumentos ya llegan validados por el esquema. */
export function definirHerramienta<S extends z.ZodType>(def: DefinicionHerramienta<S>): HerramientaAsistente {
  return {
    nombre: def.nombre,
    etiqueta: def.etiqueta,
    descripcion: def.descripcion,
    parametros: def.parametros,
    permisos: def.permisos,
    ...(def.permisosAlguno ? { permisosAlguno: def.permisosAlguno } : {}),
    ejecutar: (args, ctx) => def.ejecutar(args as z.output<S>, ctx),
  };
}

/** Parámetro `limite` común: entero 1..MAX_FILAS_HERRAMIENTA (por defecto 10). */
export const limiteSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_FILAS_HERRAMIENTA)
  .optional()
  .describe(`Máximo de filas (1-${MAX_FILAS_HERRAMIENTA}, por defecto ${FILAS_POR_DEFECTO}).`);

export function limiteEfectivo(limite: number | undefined): number {
  return Math.min(Math.max(limite ?? FILAS_POR_DEFECTO, 1), MAX_FILAS_HERRAMIENTA);
}

export const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa el formato AAAA-MM-DD.');

/**
 * Texto de la BD seguro para el modelo: sin saltos de línea ni caracteres de control
 * (un nombre de proveedor no debe poder colar instrucciones) y con largo acotado.
 */
export function textoSeguro(valor: unknown, max = MAX_LONGITUD_TEXTO): string {
  if (typeof valor !== 'string') return '';
  return valor.replace(/[\u0000-\u001f\u007f<>`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function redondear(n: unknown, decimales = 2): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  const f = 10 ** decimales;
  return Math.round((v + Number.EPSILON) * f) / f + 0;
}

export const kgRedondeado = (n: unknown): number => redondear(n, 2);

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria de la operación. */
export function fechaHoy(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora);
}

/** Escapa % y _ para usarlo dentro de un ilike sin comodines inesperados. */
export function patronBusqueda(texto: string): string {
  return `%${textoSeguro(texto, 40).replace(/[\\%_,()]/g, ' ').trim()}%`;
}

function recortarArreglos(valor: unknown, maxFilas: number): unknown {
  if (Array.isArray(valor)) return valor.slice(0, maxFilas).map(v => recortarArreglos(v, maxFilas));
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, recortarArreglos(v, maxFilas)]));
  }
  return valor;
}

/**
 * Serializa el resultado para el modelo respetando los topes: cada arreglo se recorta a
 * MAX_FILAS_HERRAMIENTA y, si aun así pasa de MAX_CHARS_RESULTADO, se reduce a la mitad
 * hasta que quepa. Siempre devuelve JSON válido.
 */
export function serializarAcotado(
  valor: unknown,
  maxChars = MAX_CHARS_RESULTADO,
): { texto: string; truncado: boolean } {
  let filas = MAX_FILAS_HERRAMIENTA;
  let truncado = false;
  while (filas >= 1) {
    const recortado = recortarArreglos(valor, filas);
    const plano = JSON.stringify(recortado);
    if (JSON.stringify(valor) !== plano) truncado = true;
    const texto = truncado ? JSON.stringify({ truncado: true, resultado: recortado }) : plano;
    if (texto.length <= maxChars) return { texto, truncado };
    filas = Math.floor(filas / 2);
  }
  return { texto: JSON.stringify({ error: 'El resultado es demasiado grande; pide algo más específico.' }), truncado: true };
}
