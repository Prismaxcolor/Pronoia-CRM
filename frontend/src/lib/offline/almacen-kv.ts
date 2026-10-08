/** Almacén clave-valor mínimo sobre IndexedDB para la sesión y el PIN. Base propia
 *  ('pronoia-offline-sesion') para no chocar con las de borradores, catálogos o cola.
 *  Nunca lanza: si IndexedDB no está disponible o falla, degrada (lee null / escribe false). */

export interface AlmacenKV {
  leer(clave: string): Promise<unknown>;
  escribir(clave: string, valor: unknown): Promise<boolean>;
  borrar(clave: string): Promise<boolean>;
}

const NOMBRE_BD = 'pronoia-offline-sesion';
const VERSION_BD = 1;
const TIENDA = 'kv';

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NOMBRE_BD, VERSION_BD);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(TIENDA)) req.result.createObjectStore(TIENDA);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB: no se pudo abrir'));
    req.onblocked = () => reject(new Error('IndexedDB: apertura bloqueada'));
  });
}

async function transaccion<T>(modo: IDBTransactionMode, operar: (t: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const bd = await abrir();
  return new Promise<T>((resolve, reject) => {
    const tx = bd.transaction(TIENDA, modo);
    const peticion = operar(tx.objectStore(TIENDA));
    tx.oncomplete = () => { bd.close(); resolve(peticion.result); };
    tx.onerror = () => { bd.close(); reject(tx.error ?? new Error('IndexedDB: transacción fallida')); };
    tx.onabort = () => { bd.close(); reject(tx.error ?? new Error('IndexedDB: transacción abortada')); };
  });
}

/** null si el navegador no tiene IndexedDB. */
export function crearAlmacenKvIndexedDB(): AlmacenKV | null {
  if (typeof indexedDB === 'undefined' || indexedDB === null) return null;
  return {
    async leer(clave) {
      try { return ((await transaccion('readonly', t => t.get(clave))) as unknown) ?? null; } catch { return null; }
    },
    async escribir(clave, valor) {
      try { await transaccion('readwrite', t => t.put(valor, clave)); return true; } catch { return false; }
    },
    async borrar(clave) {
      try { await transaccion('readwrite', t => t.delete(clave)); return true; } catch { return false; }
    },
  };
}

/** Almacén en memoria (pruebas y respaldo cuando no hay IndexedDB). */
export function crearAlmacenKvMemoria(): AlmacenKV {
  const mapa = new Map<string, unknown>();
  return {
    async leer(clave) { return mapa.has(clave) ? mapa.get(clave) : null; },
    async escribir(clave, valor) { mapa.set(clave, valor); return true; },
    async borrar(clave) { mapa.delete(clave); return true; },
  };
}

/** Almacén sobre sessionStorage: vive solo mientras la pestaña esté abierta. Lo usa la sesión local de quien NO
 *  marcó "Recordarme" (su token no debe quedar en IndexedDB). null si el navegador no lo permite. */
export function crearAlmacenKvSessionStorage(): AlmacenKV | null {
  try {
    if (typeof sessionStorage === 'undefined' || sessionStorage === null) return null;
  } catch {
    return null;
  }
  const llave = (clave: string) => `pronoia-kv:${clave}`;
  return {
    async leer(clave) {
      try {
        const crudo = sessionStorage.getItem(llave(clave));
        return crudo === null ? null : (JSON.parse(crudo) as unknown);
      } catch { return null; }
    },
    async escribir(clave, valor) {
      try { sessionStorage.setItem(llave(clave), JSON.stringify(valor)); return true; } catch { return false; }
    },
    async borrar(clave) {
      try { sessionStorage.removeItem(llave(clave)); return true; } catch { return false; }
    },
  };
}
