import type { EntradaEstadoCuenta } from '../../services/estado-cuenta-service';
import { disponibleDeNota } from '../../lib/cruce-notas';
import { fmt } from './pago-cobro-formato';

interface Props {
  notas: EntradaEstadoCuenta[];
  seleccionadas: string[];
  /** Notas marcadas → monto (USD, texto) a aplicar en este pago/cobro; se puede bajar para cruzarlas en parte. */
  montos: Record<string, string>;
  /** 'debito' suma al total (muestra el cargo); 'credito' lo reduce (muestra el abono en verde). */
  tipo: 'debito' | 'credito';
  textoVacio: string;
  onToggle: (notaId: string) => void;
  onMonto: (notaId: string, valor: string) => void;
}

/** Texto con el monto de la nota y, si ya se aplicó una parte, lo que le queda por aplicar. */
function ImporteNota({ nota, tipo }: { nota: EntradaEstadoCuenta; tipo: 'debito' | 'credito' }) {
  const total = tipo === 'debito' ? nota.cargo : nota.abono;
  const disponible = disponibleDeNota(nota);
  const claseImporte = tipo === 'debito' ? 'text-text-muted' : 'text-green-600';
  const signo = tipo === 'debito' ? '' : '-';
  return (
    <span className={`${claseImporte} shrink-0 text-right`}>
      {signo}${fmt(disponible)}
      {disponible < total - 0.005 && <span className="block text-[11px] text-text-muted">de ${fmt(total)} (ya se aplicó ${fmt(total - disponible)})</span>}
    </span>
  );
}

/** Notas de débito pendientes o de crédito disponibles, para marcarlas dentro del cruce; con monto editable (cruce parcial). */
function ListaNotasPago({ notas, seleccionadas, montos, tipo, textoVacio, onToggle, onMonto }: Props) {
  if (notas.length === 0) return <p className="text-xs text-text-muted">{textoVacio}</p>;
  return (
    <div className="border border-border rounded-lg divide-y divide-border max-h-48 overflow-y-auto">
      {notas.map(n => {
        const id = n.notaId;
        const marcada = !!id && seleccionadas.includes(id);
        return (
          <div key={id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-alt transition-colors">
            <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
              <input
                type="checkbox"
                checked={marcada}
                onChange={() => id && onToggle(id)}
                className="w-4 h-4 accent-brand-600 shrink-0"
              />
              <span className="text-sm text-text-primary flex-1 min-w-0 flex items-center justify-between gap-2">
                <span className="truncate">{n.descripcion}</span>
                {!marcada && <ImporteNota nota={n} tipo={tipo} />}
              </span>
            </label>
            {marcada && id && (
              <div className="relative shrink-0">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted text-xs">$</span>
                <input
                  type="number" step="0.01" min="0.01" max={disponibleDeNota(n).toFixed(2)}
                  value={montos[id] ?? disponibleDeNota(n).toFixed(2)}
                  aria-label={`Monto a aplicar de ${n.referencia ?? 'la nota'}`}
                  onChange={e => onMonto(id, e.target.value)}
                  className="w-24 pl-5 pr-2 py-1 text-right text-xs bg-surface border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-400"
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default ListaNotasPago;
