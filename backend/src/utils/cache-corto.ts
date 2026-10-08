/**
 * Caché de memoria de vida muy corta con deduplicación de cálculos en curso.
 * Pensada para lecturas pesadas que varios usuarios piden casi a la vez (p. ej. el resumen de
 * inventario). La clave debe incluir TODO lo que cambia el resultado (rango, permiso de valor...):
 * la caché no sabe nada de usuarios. Un cálculo fallido (o uno que `guardar` rechace) no se reutiliza.
 */
export interface OpcionesCacheCorto<T> {
  ttlMs: number;
  maxEntradas?: number;
  /** Solo para pruebas. */
  ahora?: () => number;
  /** Si devuelve false, el resultado se entrega pero no se guarda (p. ej. un resumen parcial). */
  guardar?: (valor: T) => boolean;
  /** TTL propio de cada resultado (p. ej. más corto para uno parcial); 0 o menos = no se guarda. Por defecto, ttlMs. */
  ttlPara?: (valor: T) => number;
}

export interface CacheCorto<T> {
  obtener(clave: string, calcular: () => Promise<T>): Promise<T>;
  invalidar(): void;
  tamano(): number;
}

const MAX_ENTRADAS_POR_DEFECTO = 20;

export function crearCacheCorto<T>(opts: OpcionesCacheCorto<T>): CacheCorto<T> {
  const ahora = opts.ahora ?? (() => Date.now());
  const maxEntradas = opts.maxEntradas ?? MAX_ENTRADAS_POR_DEFECTO;
  const guardadas = new Map<string, { valor: T; vence: number }>();
  const enCurso = new Map<string, Promise<T>>();
  let generacion = 0;

  function podar(): void {
    const t = ahora();
    for (const [k, e] of guardadas) if (e.vence <= t) guardadas.delete(k);
    while (guardadas.size > maxEntradas) {
      const masAntigua = guardadas.keys().next().value;
      if (masAntigua === undefined) break;
      guardadas.delete(masAntigua);
    }
  }

  return {
    obtener(clave, calcular) {
      const hit = guardadas.get(clave);
      if (hit && hit.vence > ahora()) return Promise.resolve(hit.valor);
      const previa = enCurso.get(clave);
      if (previa) return previa;

      const miGeneracion = generacion;
      const promesa = calcular()
        .then(valor => {
          // Si se invalidó mientras se calculaba, el resultado puede estar viejo: no se guarda.
          const ttl = opts.ttlPara?.(valor) ?? opts.ttlMs;
          if (miGeneracion === generacion && ttl > 0 && (opts.guardar?.(valor) ?? true)) {
            guardadas.set(clave, { valor, vence: ahora() + ttl });
            podar();
          }
          return valor;
        })
        .finally(() => {
          if (enCurso.get(clave) === promesa) enCurso.delete(clave);
        });
      enCurso.set(clave, promesa);
      return promesa;
    },
    invalidar() {
      generacion++;
      guardadas.clear();
      enCurso.clear();
    },
    tamano: () => guardadas.size,
  };
}
