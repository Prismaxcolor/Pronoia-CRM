/**
 * Bucle de herramientas de BLOB (function calling de OpenAI, solo lectura).
 *
 * El modelo pide consultas, el servidor las ejecuta (verificando el permiso de cada una) y
 * devuelve los resultados; máximo MAX_RONDAS_HERRAMIENTAS rondas y una última llamada obligada
 * a responder con texto. Cada llamada al proveedor y cada consulta respetan el presupuesto de
 * tiempo total (la función de Vercel Hobby corta a los 10 s).
 *
 * PRIVACIDAD: los resultados de las consultas viajan SOLO al proveedor con herramientas (OpenAI).
 * Si ese proveedor falla con datos ya consultados, el servicio NO reenvía esos datos a ningún
 * otro proveedor: responde con una frase de reserva.
 */
import { z } from 'zod';
import {
  type DefinicionHerramientaIA,
  type MensajeConHerramientas,
  type ProveedorIA,
} from '../utils/asistente-ia.js';
import {
  ejecutarHerramienta,
  type ContextoPermisos,
  type HerramientaAsistente,
  type SalidaHerramienta,
} from '../utils/asistente-herramientas.js';
import { MAX_LLAMADAS_POR_RONDA, MAX_RONDAS_HERRAMIENTAS, MAX_TOKENS_SALIDA_DATOS } from '../utils/asistente-limites.js';
import { logger } from '../utils/logger.js';

/** Tiempo máximo de cada llamada a OpenAI dentro del bucle. */
export const TIMEOUT_LLAMADA_DATOS_MS = 5000;
/** Tiempo máximo para ejecutar las consultas de una ronda. */
export const TIMEOUT_CONSULTAS_MS = 3000;
/** Si queda menos que esto, ya no se intenta otra llamada al proveedor. */
export const MARGEN_MINIMO_MS = 1200;

export class FalloBucle extends Error {
  /** true = ya se consultaron datos del negocio (no pueden salir a otros proveedores). */
  readonly conDatos: boolean;
  constructor(mensaje: string, conDatos: boolean) {
    super(mensaje);
    this.name = 'FalloBucle';
    this.conDatos = conDatos;
  }
}

export interface ResultadoBucle {
  texto: string;
  /** Etiquetas de lo que se consultó de verdad (sin repetir). */
  consultas: string[];
  /** Cuántas llamadas se rechazaron por falta de permiso. */
  denegadas: number;
}

const definiciones = new WeakMap<HerramientaAsistente, DefinicionHerramientaIA>();

/** JSON Schema de la herramienta en el formato de OpenAI (se calcula una vez). */
export function definicionParaIA(h: HerramientaAsistente): DefinicionHerramientaIA {
  const guardada = definiciones.get(h);
  if (guardada) return guardada;
  const { $schema: _omitido, ...parameters } = z.toJSONSchema(h.parametros) as Record<string, unknown>;
  const def: DefinicionHerramientaIA = {
    type: 'function',
    function: { name: h.nombre, description: h.descripcion, parameters: parameters },
  };
  definiciones.set(h, def);
  return def;
}

function conTimeout<T>(promesa: Promise<T>, ms: number, enTimeout: T): Promise<T> {
  return new Promise<T>(resolver => {
    const timer = setTimeout(() => resolver(enTimeout), ms);
    promesa.then(
      v => { clearTimeout(timer); resolver(v); },
      () => { clearTimeout(timer); resolver(enTimeout); },
    );
  });
}

const SALIDA_TIMEOUT: SalidaHerramienta = {
  estado: 'error',
  contenido: JSON.stringify({ error: 'La consulta tardó demasiado. Intenta con algo más específico.' }),
};
const SALIDA_EXCESO: SalidaHerramienta = {
  estado: 'error',
  contenido: JSON.stringify({ error: 'Demasiadas consultas a la vez; pide menos cosas por pregunta.' }),
};

export interface OpcionesBucle {
  proveedor: ProveedorIA;
  mensajes: MensajeConHerramientas[];
  herramientas: readonly HerramientaAsistente[];
  contexto: ContextoPermisos;
  userId: string;
  /** Instante (ms, mismo reloj que `reloj`) en que se agota el presupuesto total. */
  limite: number;
  reloj?: () => number;
  /** Registro con el que se ejecutan las llamadas (por defecto, el real). */
  registro?: readonly HerramientaAsistente[];
}

export async function ejecutarBucleHerramientas(op: OpcionesBucle): Promise<ResultadoBucle> {
  const { proveedor, herramientas, contexto, userId } = op;
  const reloj = op.reloj ?? Date.now;
  if (!proveedor.conversarConHerramientas) throw new FalloBucle('proveedor sin herramientas', false);

  const mensajes = [...op.mensajes];
  const defs = herramientas.map(definicionParaIA);
  const consultas = new Set<string>();
  let denegadas = 0;
  let conDatos = false;

  // Rondas 0..MAX-1 pueden pedir herramientas; la ronda MAX es la respuesta final obligada.
  for (let ronda = 0; ronda <= MAX_RONDAS_HERRAMIENTAS; ronda++) {
    const forzarTexto = ronda === MAX_RONDAS_HERRAMIENTAS;
    const restante = op.limite - reloj();
    if (restante < MARGEN_MINIMO_MS) throw new FalloBucle('presupuesto de tiempo agotado', conDatos);

    let turno;
    try {
      turno = await proveedor.conversarConHerramientas({
        mensajes,
        herramientas: defs,
        forzarTexto,
        maxTokens: MAX_TOKENS_SALIDA_DATOS,
        timeoutMs: Math.min(TIMEOUT_LLAMADA_DATOS_MS, restante - 200),
      });
    } catch (err) {
      throw new FalloBucle(err instanceof Error ? err.message : 'error', conDatos);
    }
    logger.info({
      evento: 'asistente_ia_turno',
      userId,
      proveedor: proveedor.nombre,
      ronda,
      tokensEntrada: turno.tokensEntrada,
      tokensSalida: turno.tokensSalida,
    });

    if (turno.llamadas.length === 0 || forzarTexto) {
      if (!turno.texto) throw new FalloBucle('respuesta vacía', conDatos);
      return { texto: turno.texto, consultas: [...consultas], denegadas };
    }

    mensajes.push({ role: 'assistant', content: turno.texto || null, tool_calls: turno.llamadas });
    const aEjecutar = turno.llamadas.slice(0, MAX_LLAMADAS_POR_RONDA);
    const tiempoConsultas = Math.max(500, Math.min(TIMEOUT_CONSULTAS_MS, op.limite - reloj() - MARGEN_MINIMO_MS));
    const salidas = await Promise.all(
      aEjecutar.map(l =>
        conTimeout(
          ejecutarHerramienta(l.function.name, l.function.arguments, { userId, contexto, registro: op.registro }),
          tiempoConsultas,
          SALIDA_TIMEOUT,
        ),
      ),
    );
    turno.llamadas.forEach((llamada, i) => {
      const salida = salidas[i] ?? SALIDA_EXCESO;
      if (salida.estado === 'ok') {
        conDatos = true;
        if (salida.etiqueta) consultas.add(salida.etiqueta);
      }
      if (salida.estado === 'sin_permiso') denegadas += 1;
      mensajes.push({ role: 'tool', tool_call_id: llamada.id, content: salida.contenido });
    });
  }
  throw new FalloBucle('sin respuesta final', conDatos);
}
