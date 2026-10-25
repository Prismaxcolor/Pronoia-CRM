import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react';
import { ETIQUETAS_ORDEN, type CampoOrden, type OrdenListado } from '../lib/orden-listado';

interface Props {
  orden: OrdenListado;
  onChange: (orden: OrdenListado) => void;
}

export default function SelectorOrden({ orden, onChange }: Props) {
  const esDesc = orden.sentido === 'desc';
  return (
    <div className="flex items-center gap-1">
      <select
        value={orden.campo}
        onChange={e => onChange({ ...orden, campo: e.target.value as CampoOrden })}
        aria-label="Ordenar por"
        className="px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
      >
        {(Object.keys(ETIQUETAS_ORDEN) as CampoOrden[]).map(c => (
          <option key={c} value={c}>Ordenar: {ETIQUETAS_ORDEN[c]}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onChange({ ...orden, sentido: esDesc ? 'asc' : 'desc' })}
        title={esDesc ? 'Más recientes / mayores primero' : 'Más antiguos / menores primero'}
        aria-label="Invertir orden"
        className="p-2 bg-surface-alt border border-border rounded-lg text-text-secondary hover:text-text-primary"
      >
        {esDesc ? <ArrowDownWideNarrow size={15} /> : <ArrowUpNarrowWide size={15} />}
      </button>
    </div>
  );
}
