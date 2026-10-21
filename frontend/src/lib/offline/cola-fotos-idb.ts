/** Fotos de la cola de envío: almacén propio 'fotos-cola' dentro de la base 'pronoia-offline'.
 *  Es independiente de la base de fotos de borrador ('pronoia-borrador-imagenes'), así que ninguna
 *  rutina de limpieza de borradores (huérfanas, caducidad, "salir y borrar borradores") la toca.
 *  Clave de cada registro: `cola:<opId>:<fotoId>`. */
import type { AlmacenImagenes, MetaImagen, RegistroImagen } from '../borrador-imagenes';
import { abrirBaseOffline, promesa, transaccionTerminada } from './idb';

export const TIENDA_FOTOS_COLA = 'fotos-cola';

type Registro = RegistroImagen & { llave: string };

const llaveDe = (clave: string, id: string) => `${clave}:${id}`;

export function crearAlmacenFotosColaIndexedDB(): AlmacenImagenes {
  let conexion: Promise<IDBDatabase> | null = null;
  const bd = (): Promise<IDBDatabase> => {
    if (!conexion) {
      conexion = abrirBaseOffline({ nombre: TIENDA_FOTOS_COLA, keyPath: 'llave' })
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
    const tx = (await bd()).transaction(TIENDA_FOTOS_COLA, modo);
    return { tx, t: tx.objectStore(TIENDA_FOTOS_COLA) };
  };

  return {
    async poner(registro) {
      const { tx, t } = await tienda('readwrite');
      t.put({ ...registro, llave: llaveDe(registro.clave, registro.id) } satisfies Registro);
      await transaccionTerminada(tx);
    },
    async obtener(clave, id) {
      const { t } = await tienda('readonly');
      return ((await promesa(t.get(llaveDe(clave, id)))) as RegistroImagen | undefined) ?? null;
    },
    async listar() {
      const { t } = await tienda('readonly');
      const todos = (await promesa(t.getAll())) as RegistroImagen[];
      return todos.map((r): MetaImagen => ({
        clave: r.clave, id: r.id, bytes: r.bytes, guardadoEn: r.guardadoEn,
        soloSesion: r.soloSesion, nombre: r.nombre, tipo: r.tipo,
      }));
    },
    async borrar(clave, id) {
      const { tx, t } = await tienda('readwrite');
      t.delete(llaveDe(clave, id));
      await transaccionTerminada(tx);
    },
    async borrarClave(clave) {
      const { tx, t } = await tienda('readwrite');
      t.openCursor().onsuccess = ev => {
        const cursor = (ev.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cursor) {
          if ((cursor.value as RegistroImagen).clave === clave) cursor.delete();
          cursor.continue();
        }
      };
      await transaccionTerminada(tx);
    },
    /** Vaciar TODO el almacén de la cola solo debe hacerse a propósito; nada del código de borradores lo llama. */
    async borrarTodo() {
      const { tx, t } = await tienda('readwrite');
      t.clear();
      await transaccionTerminada(tx);
    },
  };
}

let compartido: AlmacenImagenes | null | undefined;

/** null si no hay IndexedDB (entonces no se usa el modo sin conexión). */
export function almacenFotosColaDelNavegador(): AlmacenImagenes | null {
  if (compartido !== undefined) return compartido;
  try {
    compartido = typeof indexedDB === 'undefined' || indexedDB === null ? null : crearAlmacenFotosColaIndexedDB();
  } catch {
    compartido = null;
  }
  return compartido;
}
