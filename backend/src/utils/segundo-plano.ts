import { waitUntil } from '@vercel/functions';
import { logger } from './logger.js';

/**
 * Ejecuta trabajo posterior a la respuesta (avisos, envíos) sin retrasarla ni romperla.
 *
 * En Vercel (serverless) la función se congela al responder: una promesa "suelta" nunca
 * termina. `waitUntil` le dice al runtime que espere esa promesa. Fuera de Vercel (local,
 * tests) `waitUntil` no hace nada y la promesa corre igual como fire-and-forget.
 *
 * Acepta una promesa o una función (síncrona o async). Los errores solo se loguean.
 */
export function ejecutarEnSegundoPlano(trabajo: Promise<unknown> | (() => unknown), etiqueta = 'segundo_plano'): void {
  let promesa: Promise<unknown>;
  try {
    promesa = Promise.resolve(typeof trabajo === 'function' ? trabajo() : trabajo);
  } catch (err) {
    promesa = Promise.reject(err);
  }
  const segura = promesa.then(() => undefined, (err: unknown) => {
    logger.error({ evento: 'segundo_plano_error', etiqueta, mensaje: err instanceof Error ? err.message : String(err) });
  });
  try {
    waitUntil(segura);
  } catch (err) {
    logger.error({ evento: 'segundo_plano_waituntil_error', etiqueta, mensaje: err instanceof Error ? err.message : String(err) });
  }
}
