import type { EntradaEstadoCuenta } from '../../services/estado-cuenta-service';
import { fmt } from './pago-cobro-formato';

interface Props {
  notas: EntradaEstadoCuenta[];
  seleccionadas: string[];
  /** 'debito' suma al total (muestra el cargo); 'credito' lo reduce (muestra el abono en verde). */
  tipo: 'debito' | 'credito';
  textoVacio: string;
  onToggle: (notaId: string) => void;
}

/** Notas de débito pendientes o de crédito disponibles, para marcarlas dentro del cruce. */
function ListaNotasPago({ notas, seleccionadas, tipo, textoVacio, onToggle }: Props) {
  if (notas.length === 0) return <p className="text-xs text-text-muted">{textoVacio}</p>;
  return (
    <div className="border border-border rounded-lg divide-y divide-border max-h-48 overflow-y-auto">
      {notas.map(n => (
        <label key={n.notaId} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-surface-alt transition-colors">
          <input
            type="checkbox"
            checked={!!n.notaId && seleccionadas.includes(n.notaId)}
            onChange={() => n.notaId && onToggle(n.notaId)}
            className="w-4 h-4 accent-brand-600 shrink-0"
          />
          <span className="text-sm text-text-primary flex-1 flex items-center justify-between gap-2">
            <span className="truncate">{n.descripcion}</span>
            {tipo === 'debito'
              ? <span className="text-text-muted shrink-0">${fmt(n.cargo)}</span>
              : <span className="text-green-600 shrink-0">-${fmt(n.abono)}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

export default ListaNotasPago;
