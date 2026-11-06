import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';

/** Accesos a la pantalla anterior, ya posicionada en la pestaña que corresponde. */
const ENLACES = [
  { etiqueta: 'Almacenes', a: '/inventario-legacy?pestana=almacenes' },
  { etiqueta: 'Lotes', a: '/inventario-legacy?pestana=lotes' },
  { etiqueta: 'Traslados', a: '/inventario-legacy?pestana=traslados' },
  { etiqueta: 'Toma física', a: '/inventario-legacy?pestana=toma-fisica' },
] as const;

function GestionarMenu() {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('pointerdown', fuera);
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('pointerdown', fuera); document.removeEventListener('keydown', tecla); };
  }, [abierto]);

  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={abierto} onClick={() => setAbierto(v => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-secondary hover:bg-brand-50">
        Gestionar <ChevronDown size={14} aria-hidden="true" />
      </button>
      {abierto && (
        // En vertical el botón queda a la izquierda: anclar el menú a la derecha lo sacaba de la pantalla. Se ancla a la izquierda
        // del botón (y a la derecha desde sm) y nunca pasa del ancho de la pantalla.
        <ul role="menu" className="absolute left-0 z-30 mt-1 w-44 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-surface py-1 shadow-lg sm:left-auto sm:right-0">
          {ENLACES.map(e => (
            <li key={e.a} role="none">
              <Link role="menuitem" to={e.a} onClick={() => setAbierto(false)} className="block px-3 py-3 text-sm text-text-primary hover:bg-brand-50 sm:py-2">{e.etiqueta}</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default GestionarMenu;
