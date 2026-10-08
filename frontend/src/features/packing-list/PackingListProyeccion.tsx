import { useMemo } from 'react';
import { formatearPeso } from '../../lib/packing-list';
import { calcularProyeccion, parsearValorKg, type KgLote } from '../../lib/proyeccion-packing';
import type { ValoresProyeccionForm } from './formulario';

interface Props {
  kgs: KgLote[];
  valores: ValoresProyeccionForm;
  puedeEditar: boolean;
  onCambiar: (lote: string, texto: string) => void;
}

const TH = 'px-2 py-2 text-xs font-semibold text-text-secondary whitespace-nowrap';
const INPUT = 'w-28 px-2 py-1.5 bg-surface-alt border border-border rounded-md text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-70';

const usd = (n: number): string => `USD ${formatearPeso(n)}`;

/** Proyección de exportación (interna, no sale en el PDF): valor estimado por kg de cada lote, escrito a mano. */
function PackingListProyeccion({ kgs, valores, puedeEditar, onCambiar }: Props) {
  const numericos = useMemo(
    () => Object.fromEntries(Object.entries(valores).map(([lote, t]) => [lote, parsearValorKg(t)])),
    [valores]
  );
  const resumen = useMemo(() => calcularProyeccion(kgs, numericos), [kgs, numericos]);

  if (kgs.length === 0) {
    return <p className="text-sm text-text-muted">Agrega paletas al detalle para valorar los lotes incluidos.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[30rem] text-sm tabular-nums">
        <thead>
          <tr className="border-b border-border">
            <th className={`${TH} text-left`}>Lote</th>
            <th className={`${TH} text-right`}>Neto (kg)</th>
            <th className={`${TH} text-right`}>Valor estimado (USD/kg)</th>
            <th className={`${TH} text-right`}>Total estimado (USD)</th>
          </tr>
        </thead>
        <tbody>
          {resumen.lineas.map(l => {
            const invalido = (valores[l.lote] ?? '').trim() !== '' && numericos[l.lote] === null;
            const nombre = l.lote === '' ? 'Sin lote' : l.lote;
            return (
              <tr key={l.lote} className="border-b border-border/60">
                <td className="px-2 py-1.5">{nombre}</td>
                <td className="px-2 py-1.5 text-right">{formatearPeso(l.kg)}</td>
                <td className="px-2 py-1.5 text-right">
                  <input
                    aria-label={`Valor estimado por kg del lote ${nombre}`}
                    aria-invalid={invalido}
                    inputMode="decimal"
                    value={valores[l.lote] ?? ''}
                    disabled={!puedeEditar}
                    onChange={e => onCambiar(l.lote, e.target.value)}
                    className={`${INPUT} ${invalido ? 'border-red-500' : ''}`}
                  />
                </td>
                <td className="px-2 py-1.5 text-right font-medium">{l.valorKgUsd === null ? '—' : usd(l.totalUsd)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="font-bold">
            <td className="px-2 py-2">Total proyección</td>
            <td className="px-2 py-2 text-right">{formatearPeso(resumen.totalKg)}</td>
            <td />
            <td className="px-2 py-2 text-right">{usd(resumen.totalUsd)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default PackingListProyeccion;
