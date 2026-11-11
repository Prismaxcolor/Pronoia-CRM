import { Search } from 'lucide-react';
import type { Banca } from '@shared/types/index.js';

interface BuscadorProps {
  valor: string;
  onCambiar: (valor: string) => void;
}

/** Busca por descripción, referencia, correlativo (PG-0001, MV-0005…) o nombre de proveedor/cliente. */
export function BuscadorRegistros({ valor, onCambiar }: BuscadorProps) {
  return (
    <label className="relative block min-w-0 flex-1 basis-56">
      <span className="sr-only">Buscar registros</span>
      <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-w-texto2" />
      <input
        type="search"
        value={valor}
        onChange={e => onCambiar(e.target.value)}
        placeholder="Descripción, referencia, N° o proveedor…"
        className="w-full rounded-lg border border-w-borde bg-w-tarjeta py-2 pl-9 pr-3 text-sm text-w-texto placeholder:text-w-texto2 focus:outline-none focus-visible:ring-2 focus-visible:ring-w-acento"
      />
    </label>
  );
}

interface CuentasProps {
  cuentas: readonly Banca[];
  elegidas: readonly string[];
  onCambiar: (ids: string[]) => void;
}

/** Filtro multi-selección de cuentas: casillas dentro de un desplegable nativo (accesible con teclado). */
export function FiltroCuentas({ cuentas, elegidas, onCambiar }: CuentasProps) {
  const alternar = (id: string) => onCambiar(elegidas.includes(id) ? elegidas.filter(x => x !== id) : [...elegidas, id]);
  const resumen = elegidas.length === 0 ? 'Todas las cuentas' : `${elegidas.length} ${elegidas.length === 1 ? 'cuenta' : 'cuentas'}`;
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-lg border border-w-borde bg-w-tarjeta px-3 py-2 text-sm text-w-texto focus:outline-none focus-visible:ring-2 focus-visible:ring-w-acento">
        <span className="sr-only">Filtrar por cuentas: </span>{resumen}
      </summary>
      <fieldset className="absolute right-0 z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-w-borde bg-w-tarjeta p-2 shadow-lg">
        <legend className="sr-only">Cuentas</legend>
        {cuentas.map(c => (
          <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-w-grupo">
            <input type="checkbox" checked={elegidas.includes(c.id)} onChange={() => alternar(c.id)} className="h-4 w-4 accent-[var(--color-w-acento)]" />
            <span className="truncate">{c.nombre}</span>
            <span className="ml-auto text-xs text-w-texto2">{c.moneda}</span>
          </label>
        ))}
        {elegidas.length > 0 && (
          <button type="button" onClick={() => onCambiar([])} className="mt-1 w-full rounded px-2 py-1.5 text-left text-sm text-w-acento hover:bg-w-grupo focus:outline-none focus-visible:ring-2 focus-visible:ring-w-acento">
            Quitar selección
          </button>
        )}
      </fieldset>
    </details>
  );
}
