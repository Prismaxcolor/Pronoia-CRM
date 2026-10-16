import { X } from 'lucide-react';
import type { CategoriaWallet } from '@shared/types/index.js';
import { useCerrarConEscape } from '../../../hooks/use-cerrar-con-escape';
import SelectorCategoriaTarjetas from './SelectorCategoriaTarjetas';

interface Props {
  tipo: 'ingreso' | 'egreso';
  categorias: readonly CategoriaWallet[];
  /** Valor marcado: '' = ninguno, null = "Sin categoría", si no el id. */
  valor: string | null;
  onElegir: (id: string | null) => void;
  onClose: () => void;
}

/**
 * Hoja con las tarjetas de categoría: sube desde abajo en el celular y se centra en pantallas grandes.
 * Escape o tocar fuera la cierra sin cerrar el modal que la abrió.
 */
function HojaSelectorCategoria({ tipo, categorias, valor, onElegir, onClose }: Props) {
  const titulo = tipo === 'ingreso' ? 'Categoría del ingreso' : 'Categoría del egreso';
  useCerrarConEscape(onClose, false, true);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-label={titulo} className="flex max-h-[85vh] w-full flex-col rounded-t-2xl bg-surface shadow-xl sm:max-w-2xl sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border p-4">
          <h2 className="text-lg font-semibold text-text-primary">{titulo}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar selector de categoría"
            className="rounded p-1 text-text-muted hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          ><X size={20} /></button>
        </div>
        <div className="overflow-y-auto p-4">
          <SelectorCategoriaTarjetas
            categorias={categorias}
            valor={valor}
            onChange={onElegir}
            tipoMovimiento={tipo}
            permitirSinCategoria
            etiqueta={titulo}
          />
        </div>
      </div>
    </div>
  );
}

export default HojaSelectorCategoria;
