import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';
import { useSoloEnLinea } from '../../../lib/offline/solo-en-linea';
import type { AccionFila, ClaveAccion } from './registros-acciones';

const ANCHO_MENU = 232;
const MARGEN = 8;
const ALTO_ESTIMADO_ITEM = 40;
/** Acciones que escriben datos: necesitan conexión (igual que en la Wallet clásica). */
const ACCIONES_QUE_ESCRIBEN: ReadonlySet<ClaveAccion> = new Set(['cobrar', 'editar', 'categoria', 'anular']);

interface Props {
  /** Nombre de la fila para el lector de pantalla: "Acciones de Comisión bancaria". */
  nombreFila: string;
  acciones: readonly AccionFila[];
  nota: string | null;
  onSeleccionar: (clave: ClaveAccion) => void;
  /** Se llamó a una acción desactivada o sin conexión: quien abre explica el motivo (toast). */
  onDenegada: (motivo: string) => void;
}

interface Posicion { left: number; top?: number; bottom?: number }

function calcularPosicion(boton: HTMLElement, cantidad: number): Posicion {
  const r = boton.getBoundingClientRect();
  const left = Math.max(MARGEN, Math.min(r.right - ANCHO_MENU, window.innerWidth - ANCHO_MENU - MARGEN));
  const alto = cantidad * ALTO_ESTIMADO_ITEM + MARGEN * 2;
  const cabeAbajo = r.bottom + 4 + alto <= window.innerHeight;
  return cabeAbajo ? { left, top: r.bottom + 4 } : { left, bottom: window.innerHeight - r.top + 4 };
}

/** Menú ⋮ de una fila: teclado completo (flechas, Inicio/Fin, Escape, Tab) y foco devuelto al botón al cerrar. */
function MenuAccionesFila({ nombreFila, acciones, nota, onSeleccionar, onDenegada }: Props) {
  const soloEnLinea = useSoloEnLinea();
  const [abierto, setAbierto] = useState(false);
  const [posicion, setPosicion] = useState<Posicion | null>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const idMenu = useId();

  const items = useCallback(() => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []), []);
  const cerrar = useCallback((devolverFoco: boolean) => {
    setAbierto(false);
    if (devolverFoco) boton.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!abierto || !boton.current) return;
    setPosicion(calcularPosicion(boton.current, acciones.length + (nota ? 1 : 0)));
  }, [abierto, acciones.length, nota]);

  useEffect(() => {
    if (abierto && posicion) items()[0]?.focus();
  }, [abierto, posicion, items]);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: Event) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !boton.current?.contains(t)) setAbierto(false);
    };
    const cerrarSinFoco = () => setAbierto(false);
    document.addEventListener('pointerdown', fuera);
    window.addEventListener('resize', cerrarSinFoco);
    window.addEventListener('scroll', cerrarSinFoco, true);
    return () => {
      document.removeEventListener('pointerdown', fuera);
      window.removeEventListener('resize', cerrarSinFoco);
      window.removeEventListener('scroll', cerrarSinFoco, true);
    };
  }, [abierto]);

  const alTeclear = (e: KeyboardEvent<HTMLDivElement>) => {
    const lista = items();
    const actual = lista.indexOf(document.activeElement as HTMLElement);
    const mover = (i: number) => { e.preventDefault(); lista[(i + lista.length) % lista.length]?.focus(); };
    if (e.key === 'ArrowDown') mover(actual + 1);
    else if (e.key === 'ArrowUp') mover(actual - 1);
    else if (e.key === 'Home') mover(0);
    else if (e.key === 'End') mover(lista.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(true); }
    else if (e.key === 'Tab') cerrar(false);
  };

  const elegir = (a: AccionFila, sinConexion: boolean) => {
    cerrar(true);
    if (a.desactivada) { onDenegada(a.motivo ?? 'Esta acción no está disponible.'); return; }
    if (sinConexion) { onDenegada(soloEnLinea.titulo ?? 'Esta acción requiere conexión a internet.'); return; }
    onSeleccionar(a.clave);
  };

  return (
    <>
      <button
        ref={boton}
        type="button"
        aria-label={`Acciones de ${nombreFila}`}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={abierto ? idMenu : undefined}
        onClick={() => setAbierto(a => !a)}
        className="flex h-9 w-9 items-center justify-center rounded-full text-w-texto2 hover:bg-w-grupo hover:text-w-texto focus:outline-none focus-visible:ring-2 focus-visible:ring-w-acento"
      >
        <MoreVertical size={18} aria-hidden="true" />
      </button>
      {abierto && createPortal(
        <div
          ref={menu}
          id={idMenu}
          style={{ position: 'fixed', width: ANCHO_MENU, visibility: posicion ? 'visible' : 'hidden', ...posicion }}
          onKeyDown={alTeclear}
          className="z-50 rounded-xl border border-w-borde bg-w-tarjeta p-1 shadow-lg"
        >
          <div role="menu" aria-label={`Acciones de ${nombreFila}`}>
            {acciones.map(a => {
              const sinConexion = ACCIONES_QUE_ESCRIBEN.has(a.clave) && soloEnLinea.props(false).disabled;
              const apagada = a.desactivada || sinConexion;
              const motivo = a.desactivada ? a.motivo : sinConexion ? soloEnLinea.props(false).title : null;
              return (
                <button
                  key={a.clave}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  aria-disabled={apagada || undefined}
                  title={motivo ?? undefined}
                  onClick={() => elegir(a, sinConexion)}
                  className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm focus:outline-none focus-visible:bg-w-grupo focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-w-acento ${apagada ? 'cursor-not-allowed text-w-texto2 opacity-60' : a.peligro ? 'text-w-negativo hover:bg-w-grupo' : 'text-w-texto hover:bg-w-grupo'}`}
                >
                  {a.etiqueta}
                  {a.desactivada && <span className="sr-only">: {a.motivo}</span>}
                </button>
              );
            })}
          </div>
          {nota && <p className="border-t border-w-borde px-3 py-2 text-xs text-w-texto2">{nota}</p>}
        </div>,
        document.body,
      )}
    </>
  );
}

export default MenuAccionesFila;
