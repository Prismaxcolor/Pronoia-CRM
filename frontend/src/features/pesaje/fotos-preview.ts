import { fotoLocalDeFile, previewFotoLocal, type FotoLocal } from '../../lib/foto-picker';

/** Libera una URL creada con URL.createObjectURL. Inyectable para probar sin navegador. */
export type RevocarUrl = (url: string) => void;

const revocarUrlNavegador: RevocarUrl = url => URL.revokeObjectURL(url);

/** Fotos nuevas (con su vista previa local) a partir de los archivos elegidos. */
export function fotosNuevasDeFiles(files: readonly File[]): FotoLocal[] {
  return files.map(fotoLocalDeFile);
}

/** Libera la vista previa de una foto recién elegida; las ya subidas (URL remota) no se tocan. */
export function revocarFoto(foto: FotoLocal | undefined, revocar: RevocarUrl = revocarUrlNavegador): void {
  if (foto && foto.tipo === 'nueva') revocar(previewFotoLocal(foto));
}

export function revocarFotos(fotos: readonly FotoLocal[], revocar: RevocarUrl = revocarUrlNavegador): void {
  fotos.forEach(foto => revocarFoto(foto, revocar));
}

/** Libera las vistas previas de todas las fotos de un grupo de filas (material, pesada, lote...). */
export function revocarFotosDeFilas(
  filas: ReadonlyArray<{ fotos: readonly FotoLocal[] }>,
  revocar: RevocarUrl = revocarUrlNavegador,
): void {
  filas.forEach(fila => revocarFotos(fila.fotos, revocar));
}

/** Copia de `fotos` sin la posición `indice`. No libera nada: quien la llama decide cuándo revocar. */
export function sinFotoEn(fotos: readonly FotoLocal[], indice: number): FotoLocal[] {
  return fotos.filter((_, i) => i !== indice);
}

/** Fotos actuales más las recién elegidas. */
export function conFotosAgregadas(fotos: readonly FotoLocal[], files: readonly File[]): FotoLocal[] {
  return [...fotos, ...fotosNuevasDeFiles(files)];
}

/** Quita la foto de la posición `indice` y libera su vista previa (si era nueva). */
export function quitarFotoLiberando(fotos: readonly FotoLocal[], indice: number, revocar: RevocarUrl = revocarUrlNavegador): FotoLocal[] {
  revocarFoto(fotos[indice], revocar);
  return sinFotoEn(fotos, indice);
}
