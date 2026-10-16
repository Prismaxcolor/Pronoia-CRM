/** Detección del formato real de una imagen por su firma (magic bytes), sin dependencias.
 *  El MIME y el nombre los declara el cliente; la firma del contenido no. */

export type FormatoImagen = 'jpeg' | 'png' | 'webp';

interface InfoFormato { mime: string; extension: string }

const INFO: Record<FormatoImagen, InfoFormato> = {
  jpeg: { mime: 'image/jpeg', extension: 'jpg' },
  png: { mime: 'image/png', extension: 'png' },
  webp: { mime: 'image/webp', extension: 'webp' },
};

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function empiezaCon(b: Uint8Array, firma: number[], desde = 0): boolean {
  return b.length >= desde + firma.length && firma.every((v, i) => b[desde + i] === v);
}

/** Formato real según los primeros bytes, o null si no es JPEG, PNG ni WEBP. */
export function detectarFormatoImagen(buffer: Uint8Array): FormatoImagen | null {
  if (empiezaCon(buffer, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (empiezaCon(buffer, PNG)) return 'png';
  // WEBP: "RIFF" + tamaño(4) + "WEBP"
  if (empiezaCon(buffer, [0x52, 0x49, 0x46, 0x46]) && empiezaCon(buffer, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  return null;
}

export function infoFormatoImagen(formato: FormatoImagen): InfoFormato {
  return INFO[formato];
}

/** ¿El tipo MIME que declara el cliente coincide con el formato real según la firma del contenido? */
export function mimeCoincideConFirma(mimeDeclarado: string | undefined, buffer: Uint8Array): boolean {
  const formato = detectarFormatoImagen(buffer);
  return formato !== null && mimeDeclarado === infoFormatoImagen(formato).mime;
}

/**
 * Límites de multer para subir UNA imagen: un solo archivo, ningún campo de texto y como mucho dos partes del cuerpo
 * (evita multipartes con miles de partes o campos que gastan memoria antes de llegar a las validaciones).
 */
export function limitesSubidaImagen(tamanoMaximo: number) {
  return { fileSize: tamanoMaximo, files: 1, fields: 0, parts: 2 } as const;
}
