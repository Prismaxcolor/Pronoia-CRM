import { Plus } from 'lucide-react';
import type { ComponentProps } from 'react';
import { LABEL_CLASS } from './pesaje-clases';
import MaterialFilaCard from './MaterialFilaCard';
import type { MaterialFila } from './material-fila';

type PropsFila = ComponentProps<typeof MaterialFilaCard>;

interface Props extends Omit<PropsFila, 'fila' | 'numero' | 'puedeQuitar'> {
  materiales: MaterialFila[];
  /** Lo que le falta a la última fila para poder agregar otra; vacío si está completa. */
  faltaParaAgregar: string[];
  onAgregarMaterial: () => void;
}

/** Lista de materiales del formulario "Nuevo pesaje" y el botón para agregar otro. */
function MaterialesSeccion({ materiales, faltaParaAgregar, onAgregarMaterial, ...propsFila }: Props) {
  return (
    <div className="space-y-3">
      <label className={LABEL_CLASS + ' mb-0'}>Materiales</label>

      {materiales.map((f, idx) => (
        <MaterialFilaCard key={f.uid} fila={f} numero={idx + 1} puedeQuitar={materiales.length > 1} {...propsFila} />
      ))}

      <button
        type="button"
        onClick={onAgregarMaterial}
        disabled={faltaParaAgregar.length > 0}
        className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Plus size={16} />
        Agregar material
      </button>
      {faltaParaAgregar.length > 0 && (
        <p role="status" className="text-xs text-amber-700">
          Para agregar otro material completa el actual. Falta: {faltaParaAgregar.join(', ')}.
        </p>
      )}
    </div>
  );
}

export default MaterialesSeccion;
