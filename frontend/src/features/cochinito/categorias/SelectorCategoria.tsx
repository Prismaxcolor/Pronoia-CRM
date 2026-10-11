import { useId } from 'react';
import type { CategoriaWallet } from '@shared/types/index.js';
import {
  VALOR_SIN_CATEGORIA, opcionesParaTipo, type EleccionCategoria,
} from './categorias-logica';

interface Props {
  tipo: 'ingreso' | 'egreso';
  categorias: readonly CategoriaWallet[];
  valor: EleccionCategoria;
  onChange: (e: EleccionCategoria) => void;
  /** Mensaje de error de validación (falta elegir). */
  error?: string | null;
}

const CAMPO = 'w-full px-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';

/**
 * Categoría y subcategoría de un ingreso o egreso. No hay valor predeterminado: hay que elegir una categoría
 * o la opción explícita "Sin categoría". La subcategoría aparece solo si la categoría elegida tiene.
 */
function SelectorCategoria({ tipo, categorias, valor, onChange, error }: Props) {
  const base = useId();
  const opciones = opcionesParaTipo(categorias, tipo);
  const elegida = opciones.find(n => n.categoria.id === valor.categoria);
  const hijas = elegida?.hijas ?? [];
  const idCategoria = `${base}-cat`;
  const idError = `${base}-err`;

  return (
    <div className="space-y-2">
      <div>
        <label htmlFor={idCategoria} className="block text-xs font-medium text-text-secondary mb-1">Categoría</label>
        <div className="flex items-center gap-2">
          {elegida && <span className="h-4 w-4 shrink-0 rounded-full border border-border" style={{ backgroundColor: elegida.categoria.color }} aria-hidden="true" />}
          <select
            id={idCategoria}
            value={valor.categoria}
            onChange={e => onChange({ categoria: e.target.value, subcategoria: '' })}
            aria-invalid={!!error}
            aria-describedby={error ? idError : undefined}
            className={CAMPO}
          >
            <option value="">— Elige una categoría —</option>
            <option value={VALOR_SIN_CATEGORIA}>Sin categoría</option>
            {opciones.map(n => <option key={n.categoria.id} value={n.categoria.id}>{n.categoria.nombre}</option>)}
          </select>
        </div>
      </div>
      {hijas.length > 0 && (
        <div>
          <label htmlFor={`${base}-sub`} className="block text-xs font-medium text-text-secondary mb-1">
            Subcategoría <span className="text-text-muted">(opcional)</span>
          </label>
          <select id={`${base}-sub`} value={valor.subcategoria} onChange={e => onChange({ ...valor, subcategoria: e.target.value })} className={CAMPO}>
            <option value="">Solo la categoría, sin subcategoría</option>
            {hijas.map(h => <option key={h.id} value={h.id}>{h.nombre}</option>)}
          </select>
        </div>
      )}
      {error && <p id={idError} className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

export default SelectorCategoria;
