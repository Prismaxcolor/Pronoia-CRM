import { useState } from 'react';
import { Share2, Loader2 } from 'lucide-react';
import { useToast } from '../hooks/use-toast-context';
import type { ArchivoPdf } from '../services/pdf-documento';

interface CompartirBotonProps {
  /** Título del documento (se usa como título/mensaje al compartir). */
  titulo: string;
  /** Genera el PDF en memoria (misma función que el botón PDF, en modo 'blob').
   *  Si se omite, solo se comparte el enlace de la página actual. */
  obtenerPdf?: () => Promise<ArchivoPdf | undefined>;
  className?: string;
  /** Oculta el texto (para barras donde Imprimir también es solo icono). */
  soloIcono?: boolean;
}

const CLASE_BASE =
  'flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors disabled:opacity-60';

function esCancelacion(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

/** Sin Web Share (escritorio): abre WhatsApp con el enlace y lo copia al portapapeles. */
async function compartirPorEnlace(texto: string, url: string, toast: ReturnType<typeof useToast>): Promise<void> {
  let copiado = false;
  try {
    await navigator.clipboard.writeText(url);
    copiado = true;
  } catch {
    // Sin permiso de portapapeles: se sigue con WhatsApp.
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(`${texto} ${url}`)}`, '_blank', 'noopener,noreferrer');
  if (copiado) toast.info('Enlace copiado al portapapeles');
}

/**
 * Botón "Compartir" para acompañar a los botones PDF / Imprimir de cada documento.
 * Prioridad: Web Share con el PDF como archivo; si el navegador no comparte
 * archivos, título + enlace; si no hay Web Share, wa.me + copiar enlace.
 */
export default function CompartirBoton({ titulo, obtenerPdf, className, soloIcono }: CompartirBotonProps) {
  const toast = useToast();
  const [cargando, setCargando] = useState(false);

  async function compartir() {
    const url = window.location.href;
    setCargando(true);
    try {
      if (obtenerPdf) {
        const pdf = await obtenerPdf();
        if (pdf) {
          const file = new File([pdf.blob], pdf.nombre, { type: 'application/pdf' });
          if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: titulo });
            return;
          }
        }
      }
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: titulo, text: titulo, url });
        return;
      }
      await compartirPorEnlace(titulo, url, toast);
    } catch (e) {
      if (esCancelacion(e)) return;
      toast.errorMsg('No se pudo compartir el documento');
    } finally {
      setCargando(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void compartir()}
      disabled={cargando}
      className={className ?? CLASE_BASE}
      title="Compartir"
    >
      {cargando ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />}
      {!soloIcono && 'Compartir'}
    </button>
  );
}
