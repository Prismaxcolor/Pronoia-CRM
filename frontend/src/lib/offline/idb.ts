/** Apertura compartida de la base 'pronoia-offline' (almacenes 'catalogos', 'cola', ...).
 *
 *  Varias piezas offline comparten una sola base. Cada una necesita SU almacén
 *  y ninguna debe borrar los de las demás ni provocar un VersionError:
 *  se abre SIN fijar versión y, solo si falta el almacén pedido, se sube la
 *  versión en 1 para AÑADIRLO. Cualquier conexión abierta por otra pieza se
 *  cierra ante `versionchange` y se reabre sola (sin versión) con la nueva. */

export const NOMBRE_BD_OFFLINE = 'pronoia-offline';

export interface DefinicionTienda {
  nombre: string;
  keyPath: string;
}

function crearTiendaSiFalta(bd: IDBDatabase, tienda: DefinicionTienda): void {
  if (!bd.objectStoreNames.contains(tienda.nombre)) {
    bd.createObjectStore(tienda.nombre, { keyPath: tienda.keyPath });
  }
}

/** Abre la base garantizando que exista `tienda`. */
export function abrirBaseOffline(tienda: DefinicionTienda): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NOMBRE_BD_OFFLINE);
    req.onupgradeneeded = () => crearTiendaSiFalta(req.result, tienda);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB: no se pudo abrir'));
    req.onblocked = () => reject(new Error('IndexedDB: apertura bloqueada'));
    req.onsuccess = () => {
      const bd = req.result;
      if (bd.objectStoreNames.contains(tienda.nombre)) {
        resolve(bd);
        return;
      }
      const siguiente = bd.version + 1;
      bd.close();
      const up = indexedDB.open(NOMBRE_BD_OFFLINE, siguiente);
      up.onupgradeneeded = () => crearTiendaSiFalta(up.result, tienda);
      up.onsuccess = () => resolve(up.result);
      up.onerror = () => reject(up.error ?? new Error('IndexedDB: no se pudo crear el almacén'));
      up.onblocked = () => reject(new Error('IndexedDB: apertura bloqueada'));
    };
  });
}

export function promesa<T>(peticion: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    peticion.onsuccess = () => resolve(peticion.result);
    peticion.onerror = () => reject(peticion.error ?? new Error('IndexedDB: petición fallida'));
  });
}

export function transaccionTerminada(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB: transacción fallida'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB: transacción abortada'));
  });
}
