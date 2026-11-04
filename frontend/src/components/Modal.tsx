import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { debeCerrarConTecla } from '../hooks/use-cerrar-con-escape';
import { esModalSuperior, registrarModal } from '../hooks/use-pila-modales';
import { destinoTab } from '../lib/pila-modales';

const SELECTOR_ENFOCABLES = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const OVERLAY_POR_DEFECTO = 'bg-black/50 flex items-center justify-center z-50 p-4';
const PIE_CLASES = 'shrink-0 border-t border-border bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))]';

interface Props {
  onClose: () => void;
  children: ReactNode;
  /** id de un título dentro del modal (aria-labelledby). Si falta se usa el primer h2/h3 del panel. */
  tituloId?: string;
  /** Nombre accesible cuando no hay un título visible. */
  ariaLabel?: string;
  /** Cierra al tocar el fondo oscuro (por defecto no, para no perder formularios por un toque). */
  cerrarAlClicFondo?: boolean;
  /** Ignora Escape y el clic en el fondo, p. ej. mientras se guarda. */
  bloqueado?: boolean;
  /** Clases del fondo (sin `fixed inset-0`): color, alineación, z-index y padding. */
  overlayClassName?: string;
  /** Tope de ancho del panel por defecto. */
  ancho?: string;
  /** Tope de altura del panel por defecto (dvh: respeta el teclado y la barra del navegador móvil). */
  altura?: string;
  /** Reemplaza por completo las clases del panel. */
  panelClassName?: string;
  /** Pie fijo debajo del contenido que se desplaza (botones siempre visibles en el celular). */
  pie?: ReactNode;
}

function enfocablesVisibles(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(SELECTOR_ENFOCABLES)).filter(el => el.getClientRects().length > 0);
}

/** Etiqueta el modal con su primer título (h2/h3) cuando el llamador no indica uno. */
function useTituloAutomatico(panel: React.RefObject<HTMLDivElement | null>, idAuto: string, activo: boolean): string | undefined {
  const [etiquetaId, setEtiquetaId] = useState<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (!activo) return;
    const titulo = panel.current?.querySelector<HTMLElement>('h2, h3');
    if (!titulo) return;
    if (!titulo.id) titulo.id = idAuto;
    // Se lee el DOM ya montado para enlazar aria-labelledby; no se puede derivar durante el render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEtiquetaId(titulo.id);
  }, [panel, idAuto, activo]);
  return etiquetaId;
}

/** Registra el modal en la pila, cierra con Escape (solo el superior), enfoca el panel y devuelve el foco al cerrar. */
function useCicloDelModal(panel: React.RefObject<HTMLDivElement | null>, id: string, onClose: () => void, bloqueado: boolean): void {
  const onCloseRef = useRef(onClose);
  const bloqueadoRef = useRef(bloqueado);
  useEffect(() => { onCloseRef.current = onClose; bloqueadoRef.current = bloqueado; });

  useEffect(() => {
    const abridor = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const quitar = registrarModal(id);
    const el = panel.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    // Fase de captura: un modal anidado atiende Escape antes que cualquier oyente de un modal o diálogo que esté debajo.
    const alTecla = (e: KeyboardEvent) => {
      if (!esModalSuperior(id) || !debeCerrarConTecla(e.key, e.defaultPrevented, bloqueadoRef.current)) return;
      e.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener('keydown', alTecla, true);
    return () => {
      document.removeEventListener('keydown', alTecla, true);
      quitar();
      if (abridor?.isConnected) abridor.focus({ preventScroll: true });
    };
  }, [panel, id]);
}

function Modal({
  onClose, children, tituloId, ariaLabel, cerrarAlClicFondo = false, bloqueado = false,
  overlayClassName = OVERLAY_POR_DEFECTO, ancho = 'max-w-lg', altura = 'max-h-[90dvh]', panelClassName, pie,
}: Props) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const tituloAuto = useTituloAutomatico(panelRef, `modal-titulo-${id}`, !tituloId && !ariaLabel);
  useCicloDelModal(panelRef, id, onClose, bloqueado);

  const alPulsarFondo = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (cerrarAlClicFondo && !bloqueado && e.target === e.currentTarget) onClose();
  };

  const alTeclear = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !esModalSuperior(id) || !panelRef.current) return;
    const lista = enfocablesVisibles(panelRef.current);
    if (lista.length === 0) { e.preventDefault(); panelRef.current.focus(); return; }
    const destino = destinoTab(lista.length, lista.indexOf(document.activeElement as HTMLElement), e.shiftKey);
    if (destino === null) return;
    e.preventDefault();
    lista[destino].focus();
  };

  const base = panelClassName ?? `bg-surface rounded-2xl shadow-xl w-full ${ancho} ${altura} ${pie ? '' : 'overflow-y-auto'}`;
  const clasesPanel = `${base} ${pie ? 'flex flex-col overflow-hidden' : ''} overscroll-contain outline-none`;

  return (
    <div className={`fixed inset-0 ${overlayClassName}`} onMouseDown={alPulsarFondo}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId ?? (ariaLabel ? undefined : tituloAuto)}
        aria-label={ariaLabel}
        tabIndex={-1}
        className={clasesPanel}
        onKeyDown={alTeclear}
      >
        {pie ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
            <div className={PIE_CLASES}>{pie}</div>
          </>
        ) : children}
      </div>
    </div>
  );
}

export default Modal;
