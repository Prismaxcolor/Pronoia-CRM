/**
 * Compartir un documento del sistema como IMAGEN (PNG), no como PDF.
 *
 * Se usa html-to-image (serializa el DOM a SVG y lo rasteriza con el propio
 * navegador) porque html2canvas no entiende los colores modernos (oklch /
 * color-mix) que genera Tailwind v4. El PDF se descarga aparte con su botón.
 */

import { nombreArchivoDocumento } from './nombre-archivo';

export type ResultadoCompartir = 'compartido' | 'cancelado' | 'copiado' | 'descargado';

export class ErrorCompartirImagen extends Error {
  constructor(mensaje: string, options?: { cause?: unknown }) {
    super(mensaje, options);
    this.name = 'ErrorCompartirImagen';
  }
}

/** Elementos que no deben salir en la imagen (botones, migas, avisos de pantalla). */
const SELECTOR_EXCLUIDOS = 'button, nav, [data-no-imagen]';
/** En orden de prioridad (querySelector con lista no respeta prioridad, solo orden del DOM). */
const SELECTORES_OBJETIVO = ['[data-compartir-imagen]', '.print-documento', 'main'];
const PIXEL_RATIO = 2;
/** Límites seguros de canvas (Safari / iOS fallan en silencio por encima de ~16,7 M de píxeles). */
const MAX_PIXELES_CANVAS = 12_000_000;
const MAX_LADO_CANVAS = 8192;
const PIXEL_RATIO_MINIMO = 0.25;
const COLOR_FONDO_RESPALDO = '#ffffff';
/** GIF transparente 1x1: sustituye a una imagen externa que no se pudo descargar, sin tumbar toda la captura. */
const IMAGEN_RESPALDO = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Nombre de archivo seguro: sin tildes, símbolos ni espacios (el título ya lleva código y tercero). */
export function nombreArchivoImagen(titulo: string): string {
  return nombreArchivoDocumento({ prefijo: titulo || 'Documento', extension: 'png' });
}

/** Elemento a fotografiar: el marcado con data-compartir-imagen, o el documento de la página. */
export function buscarElementoCompartible(raiz: ParentNode = document): HTMLElement | null {
  for (const selector of SELECTORES_OBJETIVO) {
    const elemento = raiz.querySelector<HTMLElement>(selector);
    if (elemento) return elemento;
  }
  return null;
}

function colorFondo(): string {
  const fondo = getComputedStyle(document.body).backgroundColor;
  const transparente = !fondo || fondo === 'transparent' || fondo === 'rgba(0, 0, 0, 0)';
  return transparente ? COLOR_FONDO_RESPALDO : fondo;
}

function esNodoExcluido(nodo: Node): boolean {
  return nodo instanceof Element && nodo.matches(SELECTOR_EXCLUIDOS);
}

/** Escala de la imagen: 2x, o menos si el elemento es tan grande que superaría el límite de canvas del navegador. */
export function pixelRatioSeguro(ancho: number, alto: number): number {
  if (!(ancho > 0) || !(alto > 0)) return PIXEL_RATIO;
  const porArea = Math.sqrt(MAX_PIXELES_CANVAS / (ancho * alto));
  const porLado = MAX_LADO_CANVAS / Math.max(ancho, alto);
  return Math.max(PIXEL_RATIO_MINIMO, Math.min(PIXEL_RATIO, porArea, porLado));
}

/** Renderiza el elemento a un PNG. Lanza ErrorCompartirImagen si no se puede. */
export async function renderizarElementoAPng(elemento: HTMLElement): Promise<Blob> {
  try {
    const { toBlob } = await import('html-to-image');
    const blob = await toBlob(elemento, {
      pixelRatio: pixelRatioSeguro(elemento.scrollWidth, elemento.scrollHeight),
      imagePlaceholder: IMAGEN_RESPALDO,
      backgroundColor: colorFondo(),
      cacheBust: true,
      filter: nodo => !esNodoExcluido(nodo),
    });
    if (!blob) throw new Error('El navegador devolvió una imagen vacía');
    return blob;
  } catch (e) {
    throw new ErrorCompartirImagen('No se pudo generar la imagen del documento', { cause: e });
  }
}

function esCancelacion(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

function puedeCompartirArchivo(archivo: File): boolean {
  return typeof navigator.share === 'function'
    && typeof navigator.canShare === 'function'
    && navigator.canShare({ files: [archivo] });
}

async function copiarAlPortapapeles(blob: Blob): Promise<boolean> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    return true;
  } catch {
    return false;
  }
}

function descargarImagen(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Escritorio / navegador sin Web Share de archivos: copia al portapapeles o, si no se puede, descarga. */
async function respaldoEscritorio(blob: Blob, nombre: string): Promise<ResultadoCompartir> {
  if (await copiarAlPortapapeles(blob)) return 'copiado';
  descargarImagen(blob, nombre);
  return 'descargado';
}

/**
 * Comparte la imagen con la hoja nativa de compartir (móvil). Si el navegador no
 * comparte archivos, o la activación del usuario caducó mientras se renderizaba,
 * cae al respaldo de escritorio. La cancelación del usuario no es un error.
 */
export async function compartirImagen(blob: Blob, titulo: string, nombre = nombreArchivoImagen(titulo)): Promise<ResultadoCompartir> {
  const archivo = new File([blob], nombre, { type: 'image/png' });
  if (!puedeCompartirArchivo(archivo)) return respaldoEscritorio(blob, nombre);
  try {
    await navigator.share({ files: [archivo], title: titulo });
    return 'compartido';
  } catch (e) {
    if (esCancelacion(e)) return 'cancelado';
    if (e instanceof DOMException && e.name === 'NotAllowedError') return respaldoEscritorio(blob, nombre);
    throw new ErrorCompartirImagen('No se pudo compartir la imagen', { cause: e });
  }
}

/** Pausa entre descargas seguidas: los navegadores bloquean varias descargas simultáneas. */
const PAUSA_ENTRE_DESCARGAS_MS = 350;

/**
 * Comparte varias imágenes juntas (una por página). En móvil, una sola hoja de compartir con
 * todos los archivos; en escritorio, una descarga por imagen (el portapapeles solo admite una).
 */
export async function compartirImagenes(blobs: readonly Blob[], titulo: string): Promise<ResultadoCompartir> {
  if (blobs.length === 1) return compartirImagen(blobs[0], titulo);
  const nombres = blobs.map((_, i) => nombreArchivoImagen(`${titulo} ${i + 1} de ${blobs.length}`));
  const archivos = blobs.map((b, i) => new File([b], nombres[i], { type: 'image/png' }));
  const descargarTodas = async (): Promise<ResultadoCompartir> => {
    for (const [i, blob] of blobs.entries()) {
      if (i > 0) await new Promise(resolver => window.setTimeout(resolver, PAUSA_ENTRE_DESCARGAS_MS));
      descargarImagen(blob, nombres[i]);
    }
    return 'descargado';
  };
  const puedeCompartir = typeof navigator.share === 'function'
    && typeof navigator.canShare === 'function'
    && navigator.canShare({ files: archivos });
  if (!puedeCompartir) return descargarTodas();
  try {
    await navigator.share({ files: archivos, title: titulo });
    return 'compartido';
  } catch (e) {
    if (esCancelacion(e)) return 'cancelado';
    if (e instanceof DOMException && e.name === 'NotAllowedError') return descargarTodas();
    throw new ErrorCompartirImagen('No se pudo compartir las imágenes', { cause: e });
  }
}

/** Renderiza el elemento a imagen y la comparte. */
export async function compartirElementoComoImagen(elemento: HTMLElement, titulo: string): Promise<ResultadoCompartir> {
  const blob = await renderizarElementoAPng(elemento);
  return compartirImagen(blob, titulo);
}
