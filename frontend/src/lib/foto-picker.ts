import { comprimirImagen } from './image-compress';

/** Una foto ya subida (viene del servidor, tiene URL) o recién elegida en
 *  el navegador (todavía sin subir). Base de cualquier selector de fotos
 *  múltiples del sistema — pesaje, transformación, y las fotos de perfil de
 *  clientes/proveedores/taras/productos/comprobantes. */
export type FotoLocal =
  | { tipo: 'existente'; url: string }
  | { tipo: 'nueva'; file: File; preview: string };

/** URL para mostrar la miniatura, sea una foto ya subida o recién elegida. */
export function previewFotoLocal(f: FotoLocal): string {
  return f.tipo === 'existente' ? f.url : f.preview;
}

export function fotoLocalDeFile(file: File): FotoLocal {
  return { tipo: 'nueva', file, preview: URL.createObjectURL(file) };
}

export function fotosLocalDeUrls(urls: string[]): FotoLocal[] {
  return urls.map(url => ({ tipo: 'existente', url }));
}

/** Sube las fotos nuevas (las que ya tenían URL quedan igual) usando la
 *  función de subida del caller, y devuelve el arreglo final de URLs a
 *  mandar al backend. Null si alguna subida falla.
 *
 *  Cada foto nueva se comprime primero (ver image-compress.ts) y todas se
 *  suben EN PARALELO — antes se subían una por una sin comprimir, lo que en
 *  una conexión de patio/campo hacía que un ticket con varias fotos tardara
 *  minutos en guardarse (reportado 07-sep-2026). */
export async function subirFotosLocal(
  fotos: FotoLocal[],
  subir: (file: File) => Promise<string | null>,
): Promise<string[] | null> {
  const resultados = await Promise.all(fotos.map(async f => {
    if (f.tipo === 'existente') return f.url;
    const comprimida = await comprimirImagen(f.file);
    return subir(comprimida);
  }));
  if (resultados.some(url => url === null)) return null;
  return resultados as string[];
}
