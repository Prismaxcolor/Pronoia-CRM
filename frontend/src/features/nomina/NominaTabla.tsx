import { Trash2 } from 'lucide-react';
import { ETIQUETA_MONEDA_PAGO, formatearNumeroPrestamo } from '@shared/types/nomina';
import type { MonedaPago } from '@shared/types/nomina-calculo';
import type { RenglonCalculado, RenglonEditor } from './nomina-editor';

interface Props {
  renglones: RenglonCalculado[];
  soloLectura: boolean;
  onCambiar: (indice: number, parche: Partial<RenglonEditor>) => void;
  onQuitar: (indice: number) => void;
}

const num = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const bs = (n: number | null) => (n === null ? '—' : num(n));
const entrada = 'w-full min-w-[4.5rem] px-2 py-1.5 bg-surface-alt border border-border rounded-md text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-70';

interface CeldaNumeroProps {
  etiqueta: string;
  valor: string;
  soloLectura: boolean;
  onCambio: (v: string) => void;
}

function CeldaNumero({ etiqueta, valor, soloLectura, onCambio }: CeldaNumeroProps) {
  return <input aria-label={etiqueta} inputMode="decimal" value={valor} disabled={soloLectura} onChange={e => onCambio(e.target.value)} className={entrada} />;
}

function FilaCuotas({ r, i, soloLectura, onCambiar }: { r: RenglonCalculado; i: number; soloLectura: boolean; onCambiar: Props['onCambiar'] }) {
  const cambiarCuota = (k: number, monto: string) => onCambiar(i, { cuotas: r.cuotas.map((c, j) => (j === k ? { ...c, monto } : c)) });
  return (
    <tr className="bg-surface-alt/50">
      <td colSpan={11} className="px-3 py-2">
        <p className="mb-1 text-xs font-medium text-text-secondary">Préstamos de {r.nombre}: cuota a descontar esta semana (USD)</p>
        <div className="flex flex-wrap gap-3">
          {r.cuotas.map((c, k) => (
            <label key={c.prestamoId} className="flex items-center gap-2 text-xs text-text-secondary">
              {formatearNumeroPrestamo(c.numero)} (saldo USD {num(c.saldoUsd)})
              <span className="w-24">
                <CeldaNumero etiqueta={`Cuota de ${formatearNumeroPrestamo(c.numero)} para ${r.nombre}`} valor={c.monto} soloLectura={soloLectura} onCambio={v => cambiarCuota(k, v)} />
              </span>
            </label>
          ))}
        </div>
      </td>
    </tr>
  );
}

function NominaTabla({ renglones, soloLectura, onCambiar, onQuitar }: Props) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[980px] text-sm">
        <caption className="sr-only">Renglones de la nómina semanal</caption>
        <thead className="bg-surface-alt text-xs text-text-secondary">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">Trabajador</th>
            <th scope="col" className="px-2 py-2 text-left font-medium">Se paga en</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Días trabajados</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Monto base (USD por día)</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Total bruto (USD)</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Monto ref. (Bs)</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Bonificación extra (USD)</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Descuento por trabajo (USD)</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Cuotas de préstamo (USD)</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Total a pagar</th>
            <th scope="col" className="px-2 py-2"><span className="sr-only">Quitar</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {renglones.flatMap((r, i) => {
            const c = r.calculo;
            const fila = (
              <tr key={r.trabajadorId} className={c.negativo ? 'bg-red-50' : undefined}>
                <th scope="row" className="px-3 py-2 text-left font-medium text-text-primary">{r.nombre}</th>
                <td className="px-2 py-2">
                  <select
                    aria-label={`Moneda de pago de ${r.nombre}`} value={r.monedaPago} disabled={soloLectura}
                    onChange={e => onCambiar(i, { monedaPago: e.target.value as MonedaPago })}
                    className="px-2 py-1.5 bg-surface-alt border border-border rounded-md text-sm disabled:opacity-70"
                  >
                    <option value="USD">{ETIQUETA_MONEDA_PAGO.USD}</option>
                    <option value="BS">{ETIQUETA_MONEDA_PAGO.BS}</option>
                  </select>
                </td>
                <td className="px-2 py-2"><CeldaNumero etiqueta={`Días trabajados de ${r.nombre}`} valor={r.dias} soloLectura={soloLectura} onCambio={v => onCambiar(i, { dias: v })} /></td>
                <td className="px-2 py-2"><CeldaNumero etiqueta={`Monto base de ${r.nombre}`} valor={r.montoBase} soloLectura={soloLectura} onCambio={v => onCambiar(i, { montoBase: v })} /></td>
                <td className="px-2 py-2 text-right tabular-nums">{num(c.totalBrutoUsd)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{bs(c.montoRefBs)}</td>
                <td className="px-2 py-2"><CeldaNumero etiqueta={`Bonificación de ${r.nombre}`} valor={r.bonificacion} soloLectura={soloLectura} onCambio={v => onCambiar(i, { bonificacion: v })} /></td>
                <td className="px-2 py-2"><CeldaNumero etiqueta={`Descuento por trabajo de ${r.nombre}`} valor={r.descuentoTrabajo} soloLectura={soloLectura} onCambio={v => onCambiar(i, { descuentoTrabajo: v })} /></td>
                <td className="px-2 py-2 text-right tabular-nums">{num(c.descuentoPrestamoUsd)}</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  <p className={`font-semibold ${c.negativo ? 'text-red-700' : 'text-text-primary'}`}>USD {num(c.totalUsd)}</p>
                  <p className="text-xs text-text-secondary">Bs {bs(c.totalBs)}</p>
                  {c.negativo && <p className="text-xs font-medium text-red-700">Total negativo: los descuentos superan lo ganado</p>}
                </td>
                <td className="px-2 py-2 text-right">
                  {!soloLectura && (
                    <button type="button" onClick={() => onQuitar(i)} aria-label={`Quitar a ${r.nombre} de la nómina`} className="text-text-muted hover:text-red-600"><Trash2 size={16} /></button>
                  )}
                </td>
              </tr>
            );
            const tieneCuotas = r.cuotas.length > 0;
            return tieneCuotas ? [fila, <FilaCuotas key={`${r.trabajadorId}-cuotas`} r={r} i={i} soloLectura={soloLectura} onCambiar={onCambiar} />] : [fila];
          })}
        </tbody>
      </table>
    </div>
  );
}

export default NominaTabla;
