/** Almacén de catálogos sobre IndexedDB (base 'pronoia-offline', almacén 'catalogos').
 *  La base la comparten otras piezas offline (cola, etc.): la versión sube
 *  solo para AÑADIR almacenes, nunca para borrar los de otros dueños. */
import { NOMBRE_BD_OFFLINE, TIENDA_CATALOGOS, type AlmacenCatalogos, type RegistroCatalogo } from './catalogos-nucleo';

/** Si otro módulo sube la versión de la base, esta función abre SIN fijar
 *  versión para no provocar un VersionError; solo crea su almacén si falta. */
function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NOMBRE_BD_OFFLINE);
    req.onsuccess = () => {
      const bd = req.result;
      if (bd.objectStoreNames.contains(TIENDA_CATALOGOS)) {
        resolve(bd);
        return;
      }
      const siguiente = bd.version + 1;
      bd.close();
      const up = indexedDB.open(NOMBRE_BD_OFFLINE, siguiente);
      up.onupgradeneeded = () => {
        if (!up.result.objectStoreNames.contains(TIENDA_CATALOGOS)) {
          up.result.createObjectStore(TIENDA_CATALOGOS, { keyPath: 'clave' });
        }
      };
      up.onsuccess = () => resolve(up.result);
      up.onerror = () => reject(up.error ?? new Error('IndexedDB: no se pudo crear el almacén'));
      up.onblocked = () => reject(new Error('IndexedDB: apertura bloqueada'));
    };
    req.onupgradeneeded = () => {
      // Base nueva (versión 1): se crea el almacén en la misma apertura.
      if (!req.result.objectStoreNames.contains(TIENDA_CATALOGOS)) {
        req.result.createObjectStore(TIENDA_CATALOGOS, { keyPath: 'clave' });
      }
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB: no se pudo abrir'));
    req.onblocked = () => reject(new Error('IndexedDB: apertura bloqueada'));
  });
}

function promesa<T>(peticion: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    peticion.onsuccess = () => resolve(peticion.result);
    peticion.onerror = () => reject(peticion.error ?? new Error('IndexedDB: petición fallida'));
  });
}

function terminada(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB: transacción fallida'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB: transacción abortada'));
  });
}

export function crearAlmacenCatalogosIndexedDB(): AlmacenCatalogos {
  let conexion: Promise<IDBDatabase> | null = null;
  const bd = (): Promise<IDBDatabase> => {
    if (!conexion) {
      conexion = abrir()
        .then(db => {
          db.onclose = () => { conexion = null; };
          db.onversionchange = () => { db.close(); conexion = null; };
          return db;
        })
        .catch(e => { conexion = null; throw e; });
    }
    return conexion;
  };
  const tienda = async (modo: IDBTransactionMode) => {
    const tx = (await bd()).transaction(TIENDA_CATALOGOS, modo);
    return { tx, t: tx.objectStore(TIENDA_CATALOGOS) };
  };

  return {
    async leer(clave) {
      const { t } = await tienda('readonly');
      return (await promesa(t.get(clave))) as RegistroCatalogo | undefined;
    },
    async poner(registro) {
      const { tx, t } = await tienda('readwrite');
      t.put(registro);
      await terminada(tx);
    },
    async borrar(clave) {
      const { tx, t } = await tienda('readwrite');
      t.delete(clave);
      await terminada(tx);
    },
    async listar() {
      const { t } = await tienda('readonly');
      return (await promesa(t.getAll())) as RegistroCatalogo[];
    },
    async vaciar() {
      const { tx, t } = await tienda('readwrite');
      t.clear();
      await terminada(tx);
    },
  };
}

/** null si el navegador no ofrece IndexedDB (la caché queda desactivada). */
export function almacenCatalogosDelNavegador(): AlmacenCatalogos | null {
  return typeof indexedDB === 'undefined' ? null : crearAlmacenCatalogosIndexedDB();
}
