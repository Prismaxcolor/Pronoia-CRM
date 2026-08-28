import { subirFotoTicket } from '../../services/storage-service';
import { subirFotosLocal } from '../../lib/foto-picker';
import type { FotoMaterial } from './material-fila';

/** Una pesada individual dentro del formulario "Nuevo pesaje" — el camión
 *  puede pasar varias veces por la báscula, cada una con su propia tara y
 *  sus fotos. El peso global final es la suma de (peso - tara) de todas. */
export interface PesajeGlobalFila {
  uid: number;
  peso: string;
  tara: string;
  fotos: FotoMaterial[];
}

let UID = 0;

export function pesajeGlobalVacio(): PesajeGlobalFila {
  return { uid: UID++, peso: '', tara: '', fotos: [] };
}

export function netoPesajeGlobalFila(f: PesajeGlobalFila): number {
  return (Number(f.peso) || 0) - (Number(f.tara) || 0);
}

export function sumaPesajesGlobales(fs: PesajeGlobalFila[]): number {
  return fs.reduce((acc, f) => acc + netoPesajeGlobalFila(f), 0);
}

/** Sube las fotos nuevas de una fila y devuelve el arreglo final de URLs.
 *  Null si alguna subida falla — el caller decide qué mensaje mostrar. */
export function subirFotosPesajeGlobal(f: PesajeGlobalFila): Promise<string[] | null> {
  return subirFotosLocal(f.fotos, subirFotoTicket);
}
