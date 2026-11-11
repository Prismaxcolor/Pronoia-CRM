import { subirFotosLocal, type FotoLocal } from '../../lib/foto-picker';

/** Sube la imagen elegida (comprimida) y devuelve su URL final; { url: null } si no hay imagen; null si la subida falla. */
export async function subirImagenTercero(
  fotos: FotoLocal[],
  subir: (file: File) => Promise<string | null>,
): Promise<{ url: string | null } | null> {
  if (fotos.length === 0) return { url: null };
  const urls = await subirFotosLocal(fotos, subir);
  return urls ? { url: urls[0] ?? null } : null;
}
