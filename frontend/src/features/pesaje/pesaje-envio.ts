/** Guardado de pesajes/traslados con respaldo sin conexión. Con red todo es como siempre (se sube y se
 *  envía), pero con un `clientRequestId` generado ANTES del primer intento: si el envío se corta tras
 *  llegar al servidor, el reintento no duplica. Sin red (o si el envío falla por red) la operación se
 *  guarda en el teléfono y se envía sola al volver la señal. */
import { subirFotosLocal, type FotoLocal } from '../../lib/foto-picker';
import { subirFotoTicket } from '../../services/storage-service';
import {
  crearGuardadorFotosLocal, encolarOperacion, modoGuardadoActual, nuevoIdOperacion,
  sePuedeEncolarTrasFallo, type GuardadorFotosLocal,
} from '../../lib/offline/cola-guardado';
import type { OperacionCola } from '../../lib/offline/cola';

export interface EnvioPesaje {
  id: string;
  modo: 'cola' | 'enlinea';
  guardador?: GuardadorFotosLocal;
  capturadoEn: string;
  /** Sube las fotos (en línea) o las guarda en el teléfono (sin red); devuelve URLs o referencias locales. */
  subirFotos(fotos: FotoLocal[]): Promise<string[] | null>;
}

/** `idPrevio`: el id de un intento anterior de este mismo formulario (se conserva hasta guardar con éxito). */
export function iniciarEnvio(idPrevio: string | null): EnvioPesaje {
  const id = idPrevio ?? nuevoIdOperacion();
  const modo = modoGuardadoActual();
  const guardador = modo === 'cola' ? crearGuardadorFotosLocal(id) : undefined;
  const subir = guardador ? guardador.subir : subirFotoTicket;
  return {
    id, modo, guardador,
    capturadoEn: new Date().toISOString(),
    subirFotos: fotos => subirFotosLocal(fotos, subir),
  };
}

export type ResultadoEnLinea<T> = ({ error?: undefined } & T) | { error: string; red?: boolean };

export type ResultadoEnvio<T> =
  | { tipo: 'enviado'; resultado: T }
  | { tipo: 'encolado'; op: OperacionCola }
  | { tipo: 'error'; mensaje: string };

export interface DatosEnvio<P extends object, T> {
  envio: EnvioPesaje;
  tipo: string;
  endpoint: string;
  metodo?: 'POST' | 'PATCH';
  payload: P;
  descripcion: string;
  enviarEnLinea(cuerpo: P & { clientRequestId: string; capturadoEn: string }): Promise<ResultadoEnLinea<T>>;
}

export async function enviarOEncolar<P extends object, T>(d: DatosEnvio<P, T>): Promise<ResultadoEnvio<T>> {
  const { envio } = d;
  const encolar = async (): Promise<ResultadoEnvio<T>> => {
    const r = await encolarOperacion({
      id: envio.id, tipo: d.tipo, endpoint: d.endpoint, metodo: d.metodo ?? 'POST',
      payload: d.payload, descripcion: d.descripcion, capturadoEn: envio.capturadoEn, guardador: envio.guardador,
    });
    return r.ok ? { tipo: 'encolado', op: r.op } : { tipo: 'error', mensaje: r.error };
  };

  if (envio.modo === 'cola') return encolar();

  const cuerpo = { ...d.payload, clientRequestId: envio.id, capturadoEn: envio.capturadoEn };
  const resultado = await d.enviarEnLinea(cuerpo);
  if (resultado.error === undefined) return { tipo: 'enviado', resultado: resultado as T };
  if (resultado.red && sePuedeEncolarTrasFallo(true)) return encolar();
  return { tipo: 'error', mensaje: resultado.error };
}
