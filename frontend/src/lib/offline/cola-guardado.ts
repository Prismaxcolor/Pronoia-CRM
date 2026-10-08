/** Pegamento entre los formularios de pesaje/traslado y la cola. Los formularios llaman a estas
 *  funciones solo en la rama "sin red"; con red el flujo de siempre queda igual. */
import { almacenFotosColaDelNavegador } from './cola-fotos-idb';
import { guardarImagen } from '../borrador-imagenes';
import { estaOnline } from './conexion';
import { offlineHabilitado } from './sesion';
import { colaDisponible, encolar, nuevoIdOperacion, type OperacionCola } from './cola';
import { claveDeCola, refFoto } from './cola-tipos';
import { decidirModoGuardado, puedeEncolarTrasFallo } from './cola-guardado-logica';

export { mensajeGuardadoEnTelefono } from './cola-guardado-logica';
export { nuevoIdOperacion };

export function modoGuardadoActual(): 'cola' | 'enlinea' {
  return decidirModoGuardado({ offlineHabilitado: offlineHabilitado(), online: estaOnline(), colaDisponible: colaDisponible() });
}

export function sePuedeEncolarTrasFallo(errorDeRed: boolean): boolean {
  return puedeEncolarTrasFallo({ offlineHabilitado: offlineHabilitado(), colaDisponible: colaDisponible(), errorDeRed });
}

export interface GuardadorFotosLocal {
  /** Para `subirFotosLocal`: guarda la foto en el teléfono y devuelve su referencia `local:<id>` (null si falla). */
  subir(archivo: File): Promise<string | null>;
  fotos(): Array<{ id: string; clave: string }>;
  /** Borra lo guardado (si el encolado no llegó a completarse). */
  descartar(): Promise<void>;
}

export function crearGuardadorFotosLocal(idOperacion: string): GuardadorFotosLocal {
  const clave = claveDeCola(idOperacion);
  const guardadas: string[] = [];
  const almacen = almacenFotosColaDelNavegador();
  return {
    async subir(archivo) {
      if (!almacen) return null;
      const id = crypto.randomUUID();
      const r = await guardarImagen(almacen, clave, id, archivo);
      if (r !== 'guardada') return null;
      guardadas.push(id);
      return refFoto(id);
    },
    fotos: () => guardadas.map(id => ({ id, clave })),
    async descartar() {
      if (!almacen) return;
      for (const id of guardadas) {
        try {
          await almacen.borrar(clave, id);
        } catch {
          // Se conserva: ocupa espacio pero no se pierde nada.
        }
      }
    },
  };
}

export interface DatosEncolado {
  id: string;
  tipo: string;
  endpoint: string;
  metodo: 'POST' | 'PATCH';
  payload: unknown;
  descripcion: string;
  capturadoEn: string;
  guardador?: GuardadorFotosLocal;
}

/** Encola y confirma (leyendo de vuelta). Si falla (cuota llena, IndexedDB bloqueada) NO deja fotos a medias. */
export async function encolarOperacion(d: DatosEncolado): Promise<{ ok: true; op: OperacionCola } | { ok: false; error: string }> {
  try {
    const op = await encolar({
      id: d.id, tipo: d.tipo, endpoint: d.endpoint, metodo: d.metodo, payload: d.payload,
      descripcion: d.descripcion, capturadoEn: d.capturadoEn, fotos: d.guardador?.fotos() ?? [],
    });
    return { ok: true, op };
  } catch {
    await d.guardador?.descartar();
    return { ok: false, error: 'No se pudo guardar en el teléfono (¿sin espacio?). Libera espacio e inténtalo de nuevo; tu formulario sigue intacto.' };
  }
}
