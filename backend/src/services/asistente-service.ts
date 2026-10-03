import type { AsistenteChatInput, Personalidad } from '../utils/asistente-limites.js';
import { MAX_TOKENS_SALIDA } from '../utils/asistente-limites.js';
import { construirSystemPrompt, type RazonCharla } from '../utils/asistente-prompt.js';
import {
  completarConRespaldo,
  construirCadenaProveedores,
  ErrorIA,
  type FetchFn,
  type MensajeIA,
  type ProveedorIA,
} from '../utils/asistente-ia.js';
import {
  cargarContextoPermisos,
  herramientasPermitidas,
  type ContextoPermisos,
  type HerramientaAsistente,
} from '../utils/asistente-herramientas.js';
import { fechaHoy } from '../utils/asistente-herr-base.js';
import { logger } from '../utils/logger.js';
import { obtenerSecreto } from '../config/secretos.js';
import { ejecutarBucleHerramientas, FalloBucle } from './asistente-bucle.js';

const CLAVES_IA = ['ASISTENTE_IA_PROVIDER', 'ASISTENTE_IA_API_KEY', 'ASISTENTE_IA_MODEL'] as const;

/** Entorno para construirCadenaProveedores: cada clave sale de env o, si falta, de la tabla de secretos. */
export async function leerEntornoIA(
  leer: (clave: string) => Promise<string | undefined> = obtenerSecreto,
): Promise<Record<string, string | undefined>> {
  const valores = await Promise.all(CLAVES_IA.map(clave => leer(clave)));
  return Object.fromEntries(CLAVES_IA.map((clave, i) => [clave, valores[i]]));
}

/** Tope por proveedor en modo charla (el presupuesto total se reparte entre los proveedores). */
export const TIMEOUT_PROVEEDOR_MS = 4500;
const TIMEOUT_MINIMO_MS = 1500;
/**
 * Presupuesto total por pregunta. Vercel Hobby corta la función a los 10 s: se dejan 1,5 s de
 * margen para el arranque, la lectura de permisos y la respuesta HTTP.
 */
export const PRESUPUESTO_TOTAL_MS = 8500;

export interface RespuestaAsistente {
  respuesta: string;
  /** 'ia' = respondió un proveedor; 'reserva' = frase de reserva local. */
  origen: 'ia' | 'reserva';
  /** 'datos' = BLOB pudo consultar el sistema en esta pregunta; 'charla' = sin acceso a datos. */
  modo: 'datos' | 'charla';
  /** Qué consultó de verdad ("inventario", "facturas"...), para mostrarlo en el chat. */
  consultas: string[];
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

interface ExtraPrompt {
  modo?: 'datos' | 'charla';
  areas?: readonly string[];
  razonCharla?: RazonCharla;
  hoy?: string;
}

/**
 * Historial sin las respuestas que llevaban datos del sistema (ni la pregunta que las originó).
 * Se usa cuando la conversación puede pasar a proveedores anónimos: esas cifras no deben salir.
 */
export function historialSinDatos(historial: AsistenteChatInput['historial']): AsistenteChatInput['historial'] {
  return historial.filter((m, i) => !(m.role === 'assistant' && m.datos) && !(m.role === 'user' && historial[i + 1]?.role === 'assistant' && historial[i + 1]?.datos));
}

export function armarMensajes(input: AsistenteChatInput, extra: ExtraPrompt = {}): MensajeIA[] {
  return [
    {
      role: 'system',
      content: construirSystemPrompt({
        nombre: input.nombre,
        pagina: input.pagina,
        personalidad: input.personalidad,
        ...extra,
      }),
    },
    ...input.historial.map(({ role, content }) => ({ role, content })),
    { role: 'user', content: input.mensaje },
  ];
}

export interface OpcionesResponder {
  cadena?: ProveedorIA[];
  userId?: string;
  fetchFn?: FetchFn;
  /** Inyectables para pruebas. */
  cargarPermisos?: (userId: string) => Promise<ContextoPermisos | null>;
  registro?: readonly HerramientaAsistente[];
  reloj?: () => number;
  presupuestoMs?: number;
}

interface Plan {
  proveedor?: ProveedorIA;
  contexto?: ContextoPermisos;
  herramientas: HerramientaAsistente[];
  razon?: RazonCharla;
}

/** Decide si esta pregunta puede usar herramientas: proveedor, interruptor del usuario y permisos. */
async function planificar(input: AsistenteChatInput, cadena: ProveedorIA[], op: OpcionesResponder): Promise<Plan> {
  const proveedor = cadena.find(p => p.soportaHerramientas && p.conversarConHerramientas);
  if (!proveedor || !op.userId) return { herramientas: [], razon: 'sin_proveedor' };
  if (!input.consultarDatos) return { herramientas: [], razon: 'apagado' };
  let contexto: ContextoPermisos | null;
  try {
    contexto = await (op.cargarPermisos ?? cargarContextoPermisos)(op.userId);
  } catch (err) {
    logger.error({ evento: 'asistente_permisos_error', userId: op.userId, mensaje: err instanceof Error ? err.message : 'desconocido' });
    return { herramientas: [], razon: 'proveedor_caido' };
  }
  if (!contexto) return { herramientas: [], razon: 'sin_permisos' };
  const herramientas = herramientasPermitidas(contexto, op.registro);
  if (herramientas.length === 0) return { herramientas: [], razon: 'sin_permisos' };
  return { proveedor, contexto, herramientas };
}

const unicas = (xs: string[]): string[] => [...new Set(xs)];

const respuestaReserva = (personalidad: Personalidad): RespuestaAsistente => ({
  respuesta: respuestaDeReserva(personalidad),
  origen: 'reserva',
  modo: 'charla',
  consultas: [],
});

export async function responderChat(input: AsistenteChatInput, opciones: OpcionesResponder = {}): Promise<RespuestaAsistente> {
  const reloj = opciones.reloj ?? Date.now;
  const limite = reloj() + (opciones.presupuestoMs ?? PRESUPUESTO_TOTAL_MS);
  const cadena = opciones.cadena ?? construirCadenaProveedores(await leerEntornoIA(), opciones.fetchFn);
  const hoy = fechaHoy();
  const plan = await planificar(input, cadena, opciones);
  let razonCharla = plan.razon;
  let cadenaCharla = cadena;

  if (plan.proveedor && plan.contexto) {
    try {
      const r = await ejecutarBucleHerramientas({
        proveedor: plan.proveedor,
        mensajes: armarMensajes(input, { modo: 'datos', areas: unicas(plan.herramientas.map(h => h.etiqueta)), hoy }),
        herramientas: plan.herramientas,
        contexto: plan.contexto,
        userId: opciones.userId!,
        limite,
        reloj,
        registro: opciones.registro,
      });
      logger.info({
        evento: 'asistente_respuesta',
        userId: opciones.userId,
        proveedor: plan.proveedor.nombre,
        modo: 'datos',
        consultas: r.consultas,
        denegadas: r.denegadas,
      });
      return { respuesta: r.texto, origen: 'ia', modo: 'datos', consultas: r.consultas };
    } catch (err) {
      const conDatos = err instanceof FalloBucle && err.conDatos;
      logger.warn({
        evento: 'asistente_ia_fallo',
        userId: opciones.userId,
        modo: 'datos',
        conDatos,
        causas: [err instanceof Error ? err.message : String(err)],
      });
      // Con datos del negocio ya consultados NO se reenvían a otros proveedores.
      if (conDatos) return respuestaReserva(input.personalidad);
      razonCharla = 'proveedor_caido';
      cadenaCharla = cadena.filter(p => p !== plan.proveedor);
    }
  }

  return responderCharla(input, cadenaCharla, { razonCharla, userId: opciones.userId, limite, reloj, hoy });
}

/** Modo charla: sin datos del sistema. Reparte el tiempo que queda entre los proveedores. */
async function responderCharla(
  input: AsistenteChatInput,
  cadena: ProveedorIA[],
  ctx: { razonCharla?: RazonCharla; userId?: string; limite: number; reloj: () => number; hoy: string },
): Promise<RespuestaAsistente> {
  const restante = ctx.limite - ctx.reloj();
  if (cadena.length === 0 || restante < TIMEOUT_MINIMO_MS) return respuestaReserva(input.personalidad);
  const porProveedor = Math.floor(restante / cadena.length);
  try {
    const { texto, proveedor } = await completarConRespaldo(cadena, {
      // Los anónimos (llm7/Pollinations) nunca reciben respuestas previas que llevaban datos del sistema.
      mensajes: armarMensajes(
        cadena.some(p => !p.soportaHerramientas) ? { ...input, historial: historialSinDatos(input.historial) } : input,
        { modo: 'charla', razonCharla: ctx.razonCharla, hoy: ctx.hoy },
      ),
      maxTokens: MAX_TOKENS_SALIDA,
      timeoutMs: Math.min(TIMEOUT_PROVEEDOR_MS, Math.max(TIMEOUT_MINIMO_MS, porProveedor)),
    });
    logger.info({ evento: 'asistente_respuesta', userId: ctx.userId, proveedor, modo: 'charla' });
    return { respuesta: texto, origen: 'ia', modo: 'charla', consultas: [] };
  } catch (err) {
    logger.warn({
      evento: 'asistente_ia_fallo',
      userId: ctx.userId,
      causas: err instanceof ErrorIA ? err.causas : [String(err)],
    });
    return respuestaReserva(input.personalidad);
  }
}
