import { useEffect, type ReactNode } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useSwipe } from '../hooks/use-swipe';
import Modal from './Modal';

interface VisorFotosProps {
  fotos: string[];
  indice: number;
  onCambiar: (indice: number) => void;
  onCerrar: () => void;
  /** Texto/etiqueta bajo la foto (opcional). */
  pie?: ReactNode;
  alt?: string;
}

const BOTON_FLECHA =
  'absolute top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white/90 hover:bg-black/70 hover:text-white transition-colors';

/** Visor de fotos a pantalla completa: flechas, teclado (←/→; Esc lo resuelve <Modal>) y deslizamiento táctil. */
export default function VisorFotos({ fotos, indice, onCambiar, onCerrar, pie, alt = 'Foto ampliada' }: VisorFotosProps) {
  const hayAnterior = indice > 0;
  const haySiguiente = indice < fotos.length - 1;

  const irAnterior = () => { if (hayAnterior) onCambiar(indice - 1); };
  const irSiguiente = () => { if (haySiguiente) onCambiar(indice + 1); };

  const swipe = useSwipe(direccion => (direccion === 'izquierda' ? irSiguiente() : irAnterior()));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft' && indice > 0) onCambiar(indice - 1);
      else if (e.key === 'ArrowRight' && indice < fotos.length - 1) onCambiar(indice + 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [indice, fotos.length, onCambiar]);

  if (!fotos[indice]) return null;

  return (
    <Modal
      onClose={onCerrar}
      ariaLabel={alt}
      overlayClassName="bg-black/80 flex z-[60] print:hidden"
      panelClassName="h-full w-full"
    >
    <div className="relative flex h-full w-full items-center justify-center p-4" onClick={onCerrar} {...swipe}>
      <button type="button" onClick={onCerrar} className="absolute top-4 right-4 text-white/80 hover:text-white" title="Cerrar">
        <X size={24} />
      </button>
      {hayAnterior && (
        <button type="button" onClick={e => { e.stopPropagation(); irAnterior(); }} className={`${BOTON_FLECHA} left-3`} title="Anterior">
          <ChevronLeft size={28} />
        </button>
      )}
      {haySiguiente && (
        <button type="button" onClick={e => { e.stopPropagation(); irSiguiente(); }} className={`${BOTON_FLECHA} right-3`} title="Siguiente">
          <ChevronRight size={28} />
        </button>
      )}
      <div className="flex flex-col items-center gap-2 max-w-full max-h-full" onClick={e => e.stopPropagation()}>
        <img
          decoding="async"
          src={fotos[indice]}
          alt={alt}
          draggable={false}
          className="max-w-full max-h-[80dvh] object-contain rounded-lg select-none"
        />
        {pie && <p className="text-white text-sm bg-black/60 px-3 py-1.5 rounded-lg">{pie}</p>}
        {fotos.length > 1 && <p className="text-white/80 text-xs">{indice + 1} / {fotos.length}</p>}
      </div>
    </div>
    </Modal>
  );
}
