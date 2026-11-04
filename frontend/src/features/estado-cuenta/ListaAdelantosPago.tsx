import type { AdelantoDisponible } from '../../services/cruce-service';
import { fmt } from './pago-cobro-formato';

interface Props {
  adelantos: AdelantoDisponible[];
  montos: Record<string, string>;
  esProveedor: boolean;
  onToggle: (adelanto: AdelantoDisponible) => void;
  onMonto: (id: string, valor: string) => void;
}

/** Adelantos (proveedor) o anticipos (cliente) con saldo: se descuentan de lo que hay que pagar/cobrar. */
function ListaAdelantosPago({ adelantos, montos, esProveedor, onToggle, onMonto }: Props) {
  if (adelantos.length === 0) return <p className="text-xs text-text-muted">Sin {esProveedor ? 'adelantos' : 'anticipos'} con saldo disponible.</p>;
  return (
    <div className="border border-border rounded-lg divide-y divide-border max-h-48 overflow-y-auto">
      {adelantos.map(a => {
        const marcado = a.id in montos;
        return (
          <div key={a.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-alt transition-colors">
            <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
              <input type="checkbox" checked={marcado} onChange={() => onToggle(a)} className="w-4 h-4 accent-brand-600 shrink-0" />
              <span className="text-sm text-text-primary truncate">
                {a.codigo ?? a.id.slice(0, 8)}
                <span className="text-xs text-text-muted ml-2">{a.fecha}</span>
              </span>
            </label>
            {marcado ? (
              <div className="relative shrink-0">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted text-xs">$</span>
                <input
                  type="number" step="0.01" min="0.01" max={a.disponible.toFixed(2)}
                  value={montos[a.id]}
                  onChange={e => onMonto(a.id, e.target.value)}
                  className="w-24 pl-5 pr-2 py-1 text-right text-xs bg-surface border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-400"
                />
              </div>
            ) : (
              <span className="text-xs text-teal-700 shrink-0">${fmt(a.disponible)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default ListaAdelantosPago;
