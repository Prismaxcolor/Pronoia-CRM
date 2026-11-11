import { useMemo } from 'react';
import type { CategoriaWallet } from '@shared/types/index.js';
import { armarArbol } from './categorias-logica';

interface Props {
  categorias: readonly CategoriaWallet[];
  error: string | null;
  cargando: boolean;
  elegidas: readonly string[];
  onCambiarElegidas: (ids: string[]) => void;
  incluirSin: boolean;
  onCambiarIncluirSin: (valor: boolean) => void;
  /** Texto de ayuda sobre qué pasa si no se marca ninguna categoría. */
  ayuda: string;
  etiquetaSin?: string;
}

function alternar(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
}

/** Lista de casillas de categorías y subcategorías (con "sin categoría") compartida por los reportes del Wallet. */
function SelectorCategoriasReporte({ categorias, error, cargando, elegidas, onCambiarElegidas, incluirSin, onCambiarIncluirSin, ayuda, etiquetaSin = 'Incluir los movimientos sin categoría' }: Props) {
  const arbol = useMemo(() => armarArbol(categorias, true), [categorias]);

  const casilla = (id: string, nombre: string, color: string, archivada: boolean, sangria: boolean) => (
    <label key={id} className={`flex cursor-pointer items-center gap-2 py-1 text-sm ${sangria ? 'pl-6' : ''}`}>
      <input type="checkbox" checked={elegidas.includes(id)} onChange={() => onCambiarElegidas(alternar(elegidas, id))} className="h-4 w-4 accent-brand-600" />
      <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-border" style={{ backgroundColor: color }} aria-hidden="true" />
      <span className={archivada ? 'text-text-muted' : ''}>{nombre}{archivada ? ' (archivada)' : ''}</span>
    </label>
  );

  return (
    <div>
      <p className="mb-1 text-xs font-medium text-text-secondary">Categorías a incluir</p>
      <p className="mb-2 text-xs text-text-muted">{ayuda}</p>
      {error ? <p className="text-sm text-red-600">{error}</p> : (
        <div className="mb-3 max-h-56 overflow-y-auto rounded-lg border border-border px-3 py-1">
          {arbol.length === 0 && <p className="py-2 text-sm text-text-muted">{cargando ? 'Cargando categorías…' : 'Aún no hay categorías.'}</p>}
          {arbol.map(n => (
            <div key={n.categoria.id}>
              {casilla(n.categoria.id, n.categoria.nombre, n.categoria.color, !n.categoria.activo, false)}
              {n.hijas.map(h => casilla(h.id, h.nombre, h.color, !h.activo, true))}
            </div>
          ))}
        </div>
      )}
      <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={incluirSin} onChange={e => onCambiarIncluirSin(e.target.checked)} className="h-4 w-4 accent-brand-600" />
        {etiquetaSin}
      </label>
    </div>
  );
}

export default SelectorCategoriasReporte;
