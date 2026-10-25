import type { FacturaCV } from '../../services/factura-cv-service';
import { fmt } from './pago-cobro-formato';

interface Props {
  facturas: FacturaCV[];
  montos: Record<string, string>;
  esProveedor: boolean;
  onToggle: (factura: FacturaCV) => void;
  onMonto: (id: string, valor: string) => void;
}

/** Facturas con saldo pendiente: se marcan para aplicarles el pago/cobro y el monto de cada una es editable (pago parcial). */
function ListaFacturasPago({ facturas, montos, esProveedor, onToggle, onMonto }: Props) {
  if (facturas.length === 0) return <p className="text-xs text-text-muted">Sin facturas pendientes.</p>;
  return (
    <>
      <div className="border border-border rounded-lg divide-y divide-border max-h-48 overflow-y-auto">
        {facturas.map(f => {
          const marcada = f.id in montos;
          const saldoFactura = f.total - f.montoPagado;
          return (
            <div key={f.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-alt transition-colors">
              <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                <input type="checkbox" checked={marcada} onChange={() => onToggle(f)} className="w-4 h-4 accent-brand-600 shrink-0" />
                <span className="text-sm text-text-primary truncate">{f.codigo ?? f.id.slice(0, 8)}</span>
              </label>
              {marcada ? (
                <div className="relative shrink-0">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted text-xs">$</span>
                  <input
                    type="number" step="0.01" min="0.01" max={saldoFactura.toFixed(2)}
                    value={montos[f.id]}
                    onChange={e => onMonto(f.id, e.target.value)}
                    className="w-24 pl-5 pr-2 py-1 text-right text-xs bg-surface border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-400"
                  />
                </div>
              ) : (
                <span className="text-xs text-text-muted shrink-0">${fmt(saldoFactura)}</span>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-text-muted mt-1">
        Al marcar una factura se aplica su saldo completo por defecto — el monto es editable para un {esProveedor ? 'pago' : 'cobro'} parcial.
      </p>
    </>
  );
}

export default ListaFacturasPago;
