export type ResultadoConLimite<T> =
  | { ok: true; valor: T }
  | { ok: false; motivo: 'tiempo' }
  | { ok: false; motivo: 'error'; error: unknown };

/**
 * Espera `promesa` hasta `ms` milisegundos. Si vence, no la cancela (JS no puede) pero deja de esperarla,
 * absorbe su posible rechazo tardío y limpia el temporizador. Nunca lanza.
 */
export function conLimiteDeTiempo<T>(promesa: PromiseLike<T>, ms: number): Promise<ResultadoConLimite<T>> {
  return new Promise(resolve => {
    let terminado = false;
    const terminar = (r: ResultadoConLimite<T>) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(temporizador);
      resolve(r);
    };
    const temporizador = setTimeout(() => terminar({ ok: false, motivo: 'tiempo' }), Math.max(ms, 0));
    Promise.resolve(promesa).then(
      valor => terminar({ ok: true, valor }),
      error => terminar({ ok: false, motivo: 'error', error })
    );
  });
}
