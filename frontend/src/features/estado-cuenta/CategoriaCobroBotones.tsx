import type { CategoriaWallet } from '@shared/types/index.js';
import { colorTextoSobre } from '../cochinito/categorias/categorias-logica';

interface Props {
  opciones: readonly CategoriaWallet[];
  /** Id elegido; null = todavía no eligió. */
  valor: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
}

/** Elección obligatoria de la categoría de un cobro: botones grandes tipo radio (color de la categoría y nombre escrito). */
function CategoriaCobroBotones({ opciones, valor, onChange, disabled = false }: Props) {
  return (
    <div role="group" aria-label="Categoría del cobro">
      <label className="block text-xs font-medium text-text-secondary mb-1">Categoría del cobro *</label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {opciones.map(c => {
          const elegida = c.id === valor;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={elegida}
              disabled={disabled}
              onClick={() => onChange(c.id)}
              style={elegida ? { backgroundColor: c.color, borderColor: c.color, color: colorTextoSobre(c.color) } : { borderLeftColor: c.color }}
              className={`min-h-14 px-4 py-3 rounded-xl border-2 border-l-8 text-sm font-semibold text-left transition-colors disabled:opacity-50 ${
                elegida ? 'shadow-md' : 'bg-surface-alt border-border text-text-primary hover:bg-surface-hover'
              }`}
            >
              {elegida && <span aria-hidden="true">✓ </span>}
              {c.nombre}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default CategoriaCobroBotones;
