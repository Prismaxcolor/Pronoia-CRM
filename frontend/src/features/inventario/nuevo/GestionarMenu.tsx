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
        <ul role="menu" className="absolute right-0 z-30 mt-1 w-44 rounded-lg border border-border bg-surface py-1 shadow-lg">
          {ENLACES.map(e => (
            <li key={e.a} role="none">
              <Link role="menuitem" to={e.a} className="block px-3 py-2 text-sm text-text-primary hover:bg-brand-50">{e.etiqueta}</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default GestionarMenu;
