import { subirFotoTicket } from '../../services/storage-service';
import type { FotoMaterial } from './material-fila';

/** Una pesada individual dentro del formulario "Nuevo pesaje" — el camión
 *  puede pasar varias veces por la báscula, cada una con su propia tara y
 *  una foto. El peso global final es la suma de (peso - tara) de todas. */
export interface PesajeGlobalFila {
  uid: number;
  peso: string;
  tara: string;
  foto: FotoMaterial | null;
}

let UID = 0;

export function pesajeGlobalVacio(): PesajeGlobalFila {
  return { uid: UID++, peso: '', tara: '', foto: null };
}

export function netoPesajeGlobalFila(f: PesajeGlobalFila): number {
  return (Number(f.peso) || 0) - (Number(f.tara) || 0);
}

export function sumaPesajesGlobales(fs: PesajeGlobalFila[]): number {
  return fs.reduce((acc, f) => acc + netoPesajeGlobalFila(f), 0);
}

/** Sube la foto de una fila (si es nueva) y devuelve su URL final. `null`
 *  significa que la fila no tiene foto (no es un error); `undefined`
 *  significa que la subida falló — el caller decide qué mensaje mostrar. */
export async function subirFotoPesajeGlobal(f: PesajeGlobalFila): Promise<string | null | undefined> {
  if (!f.foto) return null;
  if (f.foto.tipo === 'existente') return f.foto.url;
  const url = await subirFotoTicket(f.foto.file);
  return url ?? undefined;
}
