import { useEffect, useRef, type KeyboardEvent } from 'react';
import { TABS, idPanel, idTab, type ClaveTab } from './estadisticas-tabs';

interface Props {
  activa: ClaveTab;
  onCambiar: (clave: ClaveTab) => void;
}

/** Pestañas desplazables (flechas, Inicio y Fin las mueven). La activa se mantiene a la vista. */
function PestanasEstadisticas({ activa, onCambiar }: Props) {
  const refs = useRef<Partial<Record<ClaveTab, HTMLButtonElement | null>>>({});

  useEffect(() => {
    refs.current[activa]?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }, [activa]);

  const alTeclear = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex(t => t.clave === activa);
    const destino = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null;
    if (destino === null) return;
    e.preventDefault();
    const clave = TABS[(destino + TABS.length) % TABS.length].clave;
    onCambiar(clave);
    refs.current[clave]?.focus();
  };

  return (
    <div role="tablist" aria-label="Secciones de estadísticas" onKeyDown={alTeclear}
      className="flex gap-1 overflow-x-auto border-b border-w-borde [scrollbar-width:none]">
      {TABS.map(t => {
        const esActiva = t.clave === activa;
        return (
          <button
            key={t.clave}
            ref={el => { refs.current[t.clave] = el; }}
            id={idTab(t.clave)}
            type="button"
            role="tab"
            aria-selected={esActiva}
            aria-controls={idPanel(t.clave)}
            tabIndex={esActiva ? 0 : -1}
            onClick={() => onCambiar(t.clave)}
            className={`shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-w-acento ${esActiva ? 'border-w-acento text-w-texto' : 'border-transparent text-w-texto2 hover:text-w-texto'}`}
          >
            {t.etiqueta}
          </button>
        );
      })}
    </div>
  );
}

export default PestanasEstadisticas;
