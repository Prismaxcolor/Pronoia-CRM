/** Contadores de trabajo en vuelo que no pasan por la cola: envíos de formularios
 *  (peticiones que escriben) y subidas de fotos. Mientras haya alguno, la app no se recarga. */

export type TipoTrabajo = 'envio' | 'subida';

const conteo: Record<TipoTrabajo, number> = { envio: 0, subida: 0 };

/** Marca el inicio; devuelve la función que lo termina (segura de llamar varias veces). */
export function iniciarTrabajoEnVuelo(tipo: TipoTrabajo): () => void {
  conteo[tipo]++;
  let terminado = false;
  return () => {
    if (terminado) return;
    terminado = true;
    conteo[tipo] = Math.max(0, conteo[tipo] - 1);
  };
}

/** Ejecuta `fn` contándola como trabajo en vuelo hasta que termine (bien o mal). */
export async function rastrearTrabajo<T>(tipo: TipoTrabajo, fn: () => Promise<T>): Promise<T> {
  const terminar = iniciarTrabajoEnVuelo(tipo);
  try {
    return await fn();
  } finally {
    terminar();
  }
}

export const hayEnvioEnVuelo = (): boolean => conteo.envio > 0;
export const hayFotosSubiendo = (): boolean => conteo.subida > 0;
