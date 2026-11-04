const DIMENSION_MAXIMA = 1600;
const CALIDAD_JPEG = 0.75;
/** Bajo este tamaño no vale la pena comprimir — ya es chica. */
const TAMANO_MINIMO_PARA_COMPRIMIR = 300 * 1024;

/**
 * Redimensiona y recomprime una foto en el navegador antes de subirla. Las
 * fotos de evidencia (pesaje, traslados, comprobantes...) vienen de la
 * cámara del celular — a veces 3-8 MB — y subirlas sin comprimir en una
 * conexión de patio/campo es lo que hacía que guardar un ticket de pesaje
 * tardara varios minutos (reportado 07-sep-2026). Si algo falla, o el
 * resultado no queda más chico, se devuelve el archivo original — nunca
 * bloquea la subida por un error de compresión.
 */
export async function comprimirImagen(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  if (file.size <= TAMANO_MINIMO_PARA_COMPRIMIR) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const escala = Math.min(1, DIMENSION_MAXIMA / Math.max(bitmap.width, bitmap.height));
    const ancho = Math.round(bitmap.width * escala);
    const alto = Math.round(bitmap.height * escala);

    const canvas = document.createElement('canvas');
    canvas.width = ancho;
    canvas.height = alto;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, ancho, alto);
    bitmap.close();

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', CALIDAD_JPEG));
    if (!blob || blob.size >= file.size) return file;

    const nombre = file.name.replace(/\.\w+$/, '') + '.jpg';
    return new File([blob], nombre, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
