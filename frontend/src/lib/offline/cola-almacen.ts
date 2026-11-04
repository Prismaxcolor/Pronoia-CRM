/** Almacén de la cola: interfaz, versión en memoria (pruebas / sin IndexedDB) y versión IndexedDB
 *  (base 'pronoia-offline', almacén 'cola'). Los registros se leen sin transformar; la
 *  normalización/migración de formato la hace `normalizarOperacion`. */
import { abrirBaseOffline, promesa, transaccionTerminada } from './idb';
import type { OperacionCola } from './cola-tipos';

export const TIENDA_COLA = 'cola';

export interface AlmacenCola {
  /** Escribe (crea o reemplaza) una operación. Debe resolver solo cuando quedó persistida. */
  poner(op: OperacionCola): Promise<void>;
  obtener(id: string): Promise<unknown | undefined>;
  /** Registros crudos, sin normalizar. */
  listar(): Promise<unknown[]>;
  borrar(id: string): Promise<void>;
}

/** Almacén en memoria. Guarda copias para que mutar el original no altere lo "persistido". */
export function crearAlmacenColaEnMemoria(): AlmacenCola {
  const datos = new Map<string, string>();
  return {
    async poner(op) { datos.set(op.id, JSON.stringify(op)); },
    async obtener(id) { const s = datos.get(id); return s === undefined ? undefined : JSON.parse(s); },
    async listar() { return [...datos.values()].map(s => JSON.parse(s)); },
    async borrar(id) { datos.delete(id); },
  };
}

export function crearAlmacenColaIndexedDB(): AlmacenCola {
  let conexion: Promise<IDBDatabase> | null = null;
  const bd = (): Promise<IDBDatabase> => {
    if (!conexion) {
      conexion = abrirBaseOffline({ nombre: TIENDA_COLA, keyPath: 'id' })
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
    const tx = (await bd()).transaction(TIENDA_COLA, modo);
    return { tx, t: tx.objectStore(TIENDA_COLA) };
  };

  return {
    async poner(op) {
      const { tx, t } = await tienda('readwrite');
      t.put(op);
      await transaccionTerminada(tx);
    },
    async obtener(id) {
      const { t } = await tienda('readonly');
      return promesa(t.get(id));
    },
    async listar() {
      const { t } = await tienda('readonly');
      return promesa(t.getAll());
    },
    async borrar(id) {
      const { tx, t } = await tienda('readwrite');
      t.delete(id);
      await transaccionTerminada(tx);
    },
  };
}

/** null si el navegador no ofrece IndexedDB: en ese caso NO se usa modo sin conexión. */
export function almacenColaDelNavegador(): AlmacenCola | null {
  return typeof indexedDB === 'undefined' || indexedDB === null ? null : crearAlmacenColaIndexedDB();
}
