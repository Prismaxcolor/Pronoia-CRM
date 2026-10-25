import type { ResultadoCruce } from '../../lib/cruce';
import { fmt } from './pago-cobro-formato';

interface Props {
  cruce: ResultadoCruce;
  hayItems: boolean;
  esProveedor: boolean;
  verbo: string;
  etiquetaAdelanto: string;
  codigoAdelanto: string;
  esCrucePuro: boolean;
  totalEditado: string;
  totalTocado: boolean;
  totalItems: number;
  totalEditadoNum: number;
  adelantoCalculado: number;
  onTotal: (valor: string) => void;
  onRestablecer: () => void;
}

/** Desglose del cruce, total editable y avisos (adelanto que se generará, total insuficiente, cruce sin dinero). */
function ResumenTotalPago(p: Props) {
  const { cruce, esProveedor, verbo, etiquetaAdelanto } = p;
  const nombreCredito = esProveedor ? 'Adelantos' : 'Anticipos';
  return (
    <>
      {p.hayItems && (
        <div className="border border-border rounded-lg px-4 py-3 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-text-secondary">Facturas seleccionadas</span><span className="text-text-primary">${fmt(cruce.totalFacturas)}</span></div>
          {cruce.totalNotasDebito > 0 && (
            <div className="flex justify-between"><span className="text-text-secondary">+ Notas de débito</span><span className="text-text-primary">${fmt(cruce.totalNotasDebito)}</span></div>
          )}
          {cruce.totalAdelantos > 0 && (
            <div className="flex justify-between"><span className="text-text-secondary">- {nombreCredito} aplicados</span><span className="text-green-600">-${fmt(cruce.totalAdelantos)}</span></div>
          )}
          {cruce.totalNotasCredito > 0 && (
            <div className="flex justify-between"><span className="text-text-secondary">- Notas de crédito</span><span className="text-green-600">-${fmt(cruce.totalNotasCredito)}</span></div>
          )}
          <div className="flex justify-between pt-1 border-t border-border font-semibold">
            <span className="text-text-primary">= A {verbo} en efectivo/banco</span>
            <span className="text-text-primary">${fmt(cruce.efectivo)}</span>
          </div>
        </div>
      )}

      {cruce.error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <p className="text-sm text-red-600">{cruce.error}</p>
        </div>
      )}

      <div className="bg-brand-50 border border-brand-200 rounded-lg px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-brand-800 shrink-0">Total a {verbo} (efectivo/banco)</span>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-700 text-sm">$</span>
            <input
              type="number" step="0.001" min="0"
              value={p.totalEditado}
              onChange={e => p.onTotal(e.target.value)}
              className="w-32 pl-6 pr-2 py-1.5 text-right text-lg font-bold text-brand-700 bg-surface border border-brand-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
        </div>
        {p.totalTocado && (
          <button type="button" onClick={p.onRestablecer} className="text-xs text-brand-700 hover:underline mt-1">
            restablecer a ${fmt(p.totalItems)}
          </button>
        )}
      </div>

      {p.adelantoCalculado > 0.01 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <p className="text-sm text-amber-800">
            Se registrará un <strong>{etiquetaAdelanto} de ${fmt(p.adelantoCalculado)}</strong> como ticket aparte (correlativo {p.codigoAdelanto}).
          </p>
        </div>
      )}
      {p.adelantoCalculado < -0.01 && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <p className="text-sm text-red-600">
            El total a {verbo} (${fmt(p.totalEditadoNum)}) es menor a lo seleccionado (${fmt(p.totalItems)}). Bajá el monto de alguna factura o desmarcala.
          </p>
        </div>
      )}

      {p.esCrucePuro && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3">
          <p className="text-sm text-indigo-800">
            <strong>Cruce sin movimiento de dinero:</strong> lo seleccionado queda saldado con {esProveedor ? 'adelantos' : 'anticipos'} y notas. No hace falta banca ni método de {esProveedor ? 'pago' : 'cobro'}; se guarda como documento de cruce (correlativo {esProveedor ? 'CR-…' : 'CRV-…'}).
          </p>
        </div>
      )}
    </>
  );
}

export default ResumenTotalPago;
