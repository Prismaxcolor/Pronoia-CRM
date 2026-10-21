import { useCallback, useEffect, useRef, useState } from 'react';
import { Share2, Loader2 } from 'lucide-react';
import { useToast } from '../hooks/use-toast-context';
import {
  buscarElementoCompartible,
  compartirImagen,
  compartirImagenes,
  renderizarElementoAPng,
  type ResultadoCompartir,
} from '../lib/compartir-imagen';

/** Espera tras montar antes de renderizar la imagen (deja cargar datos e imágenes de la página). */
const RETRASO_PRERENDER_MS = 1500;
/** Pasado este tiempo la imagen guardada se considera desactualizada y se vuelve a renderizar. */
const VIGENCIA_PRERENDER_MS = 20_000;

interface CachePrerender {
  blobs: Blob[] | null;
  vigenteHasta: number;
  enCurso: Promise<Blob[] | null> | null;
}

interface CompartirBotonProps {
  /** Título del documento (se usa como título al compartir y como nombre del archivo). */
  titulo: string;
  /** Elemento a convertir en imagen. Por defecto: el marcado con `data-compartir-imagen`,
   *  o el documento de la página (`.print-documento`), o el `<main>`. */
  obtenerElemento?: () => HTMLElement | null;
  /** Renderer alterno: genera una o varias imágenes (una por página) en lugar de fotografiar la pantalla.
   *  Si se indica, `obtenerElemento` no se usa. Se comparten todas juntas. */
  renderizarImagenes?: () => Promise<Blob[]>;
  className?: string;
  /** Oculta el texto (para barras donde Imprimir también es solo icono). */
  soloIcono?: boolean;
}

const CLASE_BASE =
  'flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors disabled:opacity-60';

function mensajeResultado(resultado: ResultadoCompartir, varias: boolean): string | undefined {
  if (resultado === 'copiado') return 'Imagen copiada al portapapeles: pégala en WhatsApp u otra app';
  if (resultado === 'descargado') {
    return varias
      ? 'Imágenes descargadas: adjúntalas todas en WhatsApp u otra app'
      : 'Imagen descargada: adjúntala en WhatsApp u otra app';
  }
  return undefined;
}

/**
 * Botón "Compartir" para acompañar a los botones PDF / Imprimir de cada pantalla.
 * Siempre comparte una IMAGEN (PNG) del documento, nunca el PDF: en móvil abre la
 * hoja de compartir del sistema; en escritorio copia la imagen o la descarga.
 * Para compartir el documento en PDF se descarga con el botón PDF.
 */
export default function CompartirBoton({ titulo, obtenerElemento, renderizarImagenes, className, soloIcono }: CompartirBotonProps) {
  const toast = useToast();
  const [cargando, setCargando] = useState(false);
  const cache = useRef<CachePrerender>({ blobs: null, vigenteHasta: 0, enCurso: null });
  const obtenerRef = useRef(obtenerElemento);
  const renderizarRef = useRef(renderizarImagenes);
  useEffect(() => {
    obtenerRef.current = obtenerElemento;
    renderizarRef.current = renderizarImagenes;
  }, [obtenerElemento, renderizarImagenes]);

  // Un renderer alterno nuevo significa datos nuevos: la imagen guardada ya no vale.
  useEffect(() => {
    if (renderizarImagenes) cache.current = { blobs: null, vigenteHasta: 0, enCurso: null };
  }, [renderizarImagenes]);

  /** Genera las imágenes a compartir: con renderer alterno, el suyo; si no, la captura del elemento. */
  const generarImagenes = useCallback((): Promise<Blob[]> | null => {
    if (renderizarRef.current) return renderizarRef.current();
    const elemento = (obtenerRef.current ?? buscarElementoCompartible)();
    return elemento ? renderizarElementoAPng(elemento).then(blob => [blob]) : null;
  }, []);

  async function compartirBlobs(blobs: Blob[]) {
    const resultado = blobs.length === 1 ? await compartirImagen(blobs[0], titulo) : await compartirImagenes(blobs, titulo);
    const mensaje = mensajeResultado(resultado, blobs.length > 1);
    if (mensaje) toast.info(mensaje);
  }

  // Renderiza la imagen antes del clic: en iOS/Safari el render consume la activación del
  // usuario y navigator.share falla. Un fallo aquí no se avisa: el clic vuelve a intentarlo.
  const precalentar = useCallback(() => {
    const c = cache.current;
    if (c.enCurso || (c.blobs && Date.now() < c.vigenteHasta)) return;
    const generacion = generarImagenes();
    if (!generacion) return;
    c.enCurso = generacion
      .then(blobs => { c.blobs = blobs; c.vigenteHasta = Date.now() + VIGENCIA_PRERENDER_MS; return blobs; })
      .catch(() => null)
      .finally(() => { c.enCurso = null; });
  }, [generarImagenes]);

  useEffect(() => {
    const t = window.setTimeout(precalentar, RETRASO_PRERENDER_MS);
    return () => window.clearTimeout(t);
  }, [precalentar]);

  async function compartir() {
    if (!renderizarImagenes && !(obtenerElemento ?? buscarElementoCompartible)()) {
      toast.errorMsg('No se encontró el contenido para compartir');
      return;
    }
    const c = cache.current;
    // Con la imagen lista se comparte en el mismo tick del clic (conserva la activación del usuario).
    if (c.blobs && Date.now() < c.vigenteHasta) {
      try {
        await compartirBlobs(c.blobs);
      } catch {
        toast.errorMsg('No se pudo compartir la imagen del documento');
      }
      return;
    }
    setCargando(true);
    try {
      const listas = c.enCurso ? await c.enCurso : null;
      const generacion = listas ? null : generarImagenes();
      const blobs = listas ?? (generacion ? await generacion : null);
      if (!blobs) throw new Error('Sin contenido para compartir');
      await compartirBlobs(blobs);
    } catch {
      toast.errorMsg('No se pudo compartir la imagen del documento');
    } finally {
      setCargando(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void compartir()}
      onPointerEnter={precalentar}
      onFocus={precalentar}
      onTouchStart={precalentar}
      disabled={cargando}
      className={className ?? CLASE_BASE}
      title="Compartir como imagen"
    >
      {cargando ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />}
      {!soloIcono && 'Compartir'}
    </button>
  );
}
