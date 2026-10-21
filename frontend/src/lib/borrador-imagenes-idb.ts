/** Almacén de imágenes de borrador sobre IndexedDB (sin dependencias).
 *  Un registro por (clave, id); índice por `clave` para borrar un borrador entero. */
import type { AlmacenImagenes, MetaImagen, RegistroImagen } from './borrador-imagenes';

const NOMBRE_BD = 'pronoia-borrador-imagenes';
const VERSION_BD = 1;
const TIENDA = 'imagenes';

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

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NOMBRE_BD, VERSION_BD);
    req.onupgradeneeded = () => {
      const bd = req.result;
      if (!bd.objectStoreNames.contains(TIENDA)) {
        const tienda = bd.createObjectStore(TIENDA, { keyPath: ['clave', 'id'] });
        tienda.createIndex('clave', 'clave', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB: no se pudo abrir'));
    req.onblocked = () => reject(new Error('IndexedDB: apertura bloqueada'));
  });
}

function crearAlmacenIndexedDB(): AlmacenImagenes {
  let conexion: Promise<IDBDatabase> | null = null;
  const bd = (): Promise<IDBDatabase> => {
    if (!conexion) {
      conexion = abrir().then(db => {
        db.onclose = () => { conexion = null; };
        db.onversionchange = () => { db.close(); conexion = null; };
        return db;
      }).catch(e => { conexion = null; throw e; });
    }
    return conexion;
  };
  const tienda = async (modo: IDBTransactionMode) => {
    const tx = (await bd()).transaction(TIENDA, modo);
    return { tx, tienda: tx.objectStore(TIENDA) };
  };

  return {
    async poner(registro: RegistroImagen) {
      const { tx, tienda: t } = await tienda('readwrite');
      t.put(registro);
      await terminada(tx);
    },
    async obtener(clave, id) {
      const { tienda: t } = await tienda('readonly');
      return ((await promesa(t.get([clave, id]))) as RegistroImagen | undefined) ?? null;
    },
    async listar() {
      const { tienda: t } = await tienda('readonly');
      const todos = (await promesa(t.getAll())) as RegistroImagen[];
      return todos.map((r): MetaImagen => ({
        clave: r.clave, id: r.id, bytes: r.bytes, guardadoEn: r.guardadoEn,
        soloSesion: r.soloSesion, nombre: r.nombre, tipo: r.tipo,
      }));
    },
    async borrar(clave, id) {
      const { tx, tienda: t } = await tienda('readwrite');
      t.delete([clave, id]);
      await terminada(tx);
    },
    async borrarClave(clave) {
      const { tx, tienda: t } = await tienda('readwrite');
      t.index('clave').openKeyCursor(IDBKeyRange.only(clave)).onsuccess = ev => {
        const cursor = (ev.target as IDBRequest<IDBCursor | null>).result;
        if (cursor) {
          t.delete(cursor.primaryKey);
          cursor.continue();
        }
      };
      await terminada(tx);
    },
    async borrarTodo() {
      const { tx, tienda: t } = await tienda('readwrite');
      t.clear();
      await terminada(tx);
    },
  };
}

let almacenCompartido: AlmacenImagenes | null | undefined;

/** Almacén de imágenes del navegador, o null si no hay IndexedDB (SSR, navegador antiguo). */
export function almacenImagenesDelNavegador(): AlmacenImagenes | null {
  if (almacenCompartido !== undefined) return almacenCompartido;
  try {
    almacenCompartido = typeof indexedDB === 'undefined' || indexedDB === null ? null : crearAlmacenIndexedDB();
  } catch {
    almacenCompartido = null;
  }
  return almacenCompartido;
}
