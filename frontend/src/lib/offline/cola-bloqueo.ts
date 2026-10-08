/** Exclusión entre pestañas para que solo una envíe la cola a la vez.
 *  Preferido: Web Locks (`navigator.locks`). Respaldo: arriendo con vencimiento en localStorage.
 *  Aun si dos pestañas coincidieran, el servidor no duplica (idempotencia por clientRequestId). */
import type { Bloqueo, ResultadoBloqueo } from './cola-motor';

export const NOMBRE_BLOQUEO_COLA = 'pronoia-cola-envio';
const CLAVE_ARRIENDO = 'pronoia-cola-arriendo';
export const TTL_ARRIENDO_MS = 120_000;

interface AdministradorLocks {
  request<T>(nombre: string, opciones: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<T>): Promise<T>;
}

export function crearBloqueoWebLocks(locks: AdministradorLocks): Bloqueo {
  return {
    ejecutar<T>(fn: () => Promise<T>): Promise<ResultadoBloqueo<T>> {
      return locks.request<ResultadoBloqueo<T>>(NOMBRE_BLOQUEO_COLA, { ifAvailable: true }, async lock => {
        if (!lock) return { ejecutado: false };
        return { ejecutado: true, valor: await fn() };
      });
    },
  };
}

export interface AlmacenArriendo {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
  removeItem(clave: string): void;
}

interface Arriendo {
  dueno: string;
  hasta: number;
}

function leerArriendo(almacen: AlmacenArriendo): Arriendo | null {
  try {
    const crudo = almacen.getItem(CLAVE_ARRIENDO);
    if (!crudo) return null;
    const a = JSON.parse(crudo) as Partial<Arriendo>;
    return typeof a.dueno === 'string' && typeof a.hasta === 'number' ? { dueno: a.dueno, hasta: a.hasta } : null;
  } catch {
    return null;
  }
}

export function crearBloqueoArriendo(
  almacen: AlmacenArriendo,
  ahora: () => number,
  idPropio: string,
  ttlMs: number = TTL_ARRIENDO_MS,
): Bloqueo {
  return {
    async ejecutar<T>(fn: () => Promise<T>): Promise<ResultadoBloqueo<T>> {
      const actual = leerArriendo(almacen);
      if (actual && actual.dueno !== idPropio && actual.hasta > ahora()) return { ejecutado: false };
      try {
        almacen.setItem(CLAVE_ARRIENDO, JSON.stringify({ dueno: idPropio, hasta: ahora() + ttlMs }));
      } catch {
        return { ejecutado: false };
      }
      // Confirmación: si dos pestañas escribieron casi a la vez, gana la última escritura.
      if (leerArriendo(almacen)?.dueno !== idPropio) return { ejecutado: false };
      try {
        return { ejecutado: true, valor: await fn() };
      } finally {
        if (leerArriendo(almacen)?.dueno === idPropio) {
          try {
            almacen.removeItem(CLAVE_ARRIENDO);
          } catch {
            // Vence solo por tiempo.
          }
        }
      }
    },
  };
}

/** Bloqueo del navegador: Web Locks si existe; si no, arriendo en localStorage; si tampoco, sin exclusión. */
export function crearBloqueoDelNavegador(): Bloqueo {
  if (typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks) {
    return crearBloqueoWebLocks(navigator.locks as unknown as AdministradorLocks);
  }
  if (typeof localStorage !== 'undefined') {
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random());
    return crearBloqueoArriendo(localStorage, Date.now, id);
  }
  return { ejecutar: async fn => ({ ejecutado: true, valor: await fn() }) };
}
