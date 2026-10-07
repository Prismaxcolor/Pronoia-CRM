import { useCallback, useEffect, useRef, useState } from 'react';
import { Share2, Loader2 } from 'lucide-react';
import { useToast } from '../hooks/use-toast-context';
import {
  buscarElementoCompartible,
  compartirElementoComoImagen,
  compartirImagen,
  renderizarElementoAPng,
  type ResultadoCompartir,
} from '../lib/compartir-imagen';

/** Espera tras montar antes de renderizar la imagen (deja cargar datos e imágenes de la página). */
const RETRASO_PRERENDER_MS = 1500;
/** Pasado este tiempo la imagen guardada se considera desactualizada y se vuelve a renderizar. */
const VIGENCIA_PRERENDER_MS = 20_000;

interface CachePrerender {
  blob: Blob | null;
  vigenteHasta: number;
  enCurso: Promise<Blob | null> | null;
}

interface CompartirBotonProps {
  /** Título del documento (se usa como título al compartir y como nombre del archivo). */
  titulo: string;
  /** Elemento a convertir en imagen. Por defecto: el marcado con `data-compartir-imagen`,
   *  o el documento de la página (`.print-documento`), o el `<main>`. */
  obtenerElemento?: () => HTMLElement | null;
  className?: string;
  /** Oculta el texto (para barras donde Imprimir también es solo icono). */
  soloIcono?: boolean;
}

const CLASE_BASE =
  'flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors disabled:opacity-60';

const MENSAJE_POR_RESULTADO: Partial<Record<ResultadoCompartir, string>> = {
  copiado: 'Imagen copiada al portapapeles: pégala en WhatsApp u otra app',
  descargado: 'Imagen descargada: adjúntala en WhatsApp u otra app',
};

/**
 * Botón "Compartir" para acompañar a los botones PDF / Imprimir de cada pantalla.
 * Siempre comparte una IMAGEN (PNG) del documento, nunca el PDF: en móvil abre la
 * hoja de compartir del sistema; en escritorio copia la imagen o la descarga.
 * Para compartir el documento en PDF se descarga con el botón PDF.
 */
export default function CompartirBoton({ titulo, obtenerElemento, className, soloIcono }: CompartirBotonProps) {
  const toast = useToast();
  const [cargando, setCargando] = useState(false);
  const cache = useRef<CachePrerender>({ blob: null, vigenteHasta: 0, enCurso: null });
  const obtenerRef = useRef(obtenerElemento);
  useEffect(() => { obtenerRef.current = obtenerElemento; }, [obtenerElemento]);

  // Renderiza la imagen antes del clic: en iOS/Safari el render consume la activación del
  // usuario y navigator.share falla. Un fallo aquí no se avisa: el clic vuelve a intentarlo.
  const precalentar = useCallback(() => {
    const c = cache.current;
    if (c.enCurso || (c.blob && Date.now() < c.vigenteHasta)) return;
    const elemento = (obtenerRef.current ?? buscarElementoCompartible)();
    if (!elemento) return;
    c.enCurso = renderizarElementoAPng(elemento)
      .then(blob => { c.blob = blob; c.vigenteHasta = Date.now() + VIGENCIA_PRERENDER_MS; return blob; })
      .catch(() => null)
      .finally(() => { c.enCurso = null; });
  }, []);

  useEffect(() => {
    const t = window.setTimeout(precalentar, RETRASO_PRERENDER_MS);
    return () => window.clearTimeout(t);
  }, [precalentar]);

  async function compartir() {
    const elemento = (obtenerElemento ?? buscarElementoCompartible)();
    if (!elemento) {
      toast.errorMsg('No se encontró el contenido para compartir');
      return;
    }
    const c = cache.current;
    // Con la imagen lista se comparte en el mismo tick del clic (conserva la activación del usuario).
    if (c.blob && Date.now() < c.vigenteHasta) {
      try {
        const resultado = await compartirImagen(c.blob, titulo);
        const mensaje = MENSAJE_POR_RESULTADO[resultado];
        if (mensaje) toast.info(mensaje);
      } catch {
        toast.errorMsg('No se pudo compartir la imagen del documento');
      }
      return;
    }
    setCargando(true);
    try {
      const enCurso = c.enCurso ? await c.enCurso : null;
      const resultado = enCurso
        ? await compartirImagen(enCurso, titulo)
        : await compartirElementoComoImagen(elemento, titulo);
      const mensaje = MENSAJE_POR_RESULTADO[resultado];
      if (mensaje) toast.info(mensaje);
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
