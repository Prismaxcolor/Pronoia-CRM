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
 *  mandar al backend. Null si alguna subida falla. */
export async function subirFotosLocal(
  fotos: FotoLocal[],
  subir: (file: File) => Promise<string | null>,
): Promise<string[] | null> {
  const urls: string[] = [];
  for (const f of fotos) {
    if (f.tipo === 'existente') { urls.push(f.url); continue; }
    const url = await subir(f.file);
    if (!url) return null;
    urls.push(url);
  }
  return urls;
}
