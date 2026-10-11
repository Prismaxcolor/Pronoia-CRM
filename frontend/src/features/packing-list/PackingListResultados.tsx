import { useMemo } from 'react';
import { formatearPeso } from '../../lib/packing-list';
import { parsearValorKg, textoValorKg, type KgLote } from '../../lib/proyeccion-packing';
import { calcularResultados } from '../../lib/resultados-exportacion';
import type { ValoracionForm } from './formulario';

interface Props {
  kgs: KgLote[];
  valoracion: ValoracionForm;
  puedeEditar: boolean;
  onCambiarReal: (lote: string, texto: string) => void;
}

const TH = 'px-2 py-2 text-xs font-semibold text-text-secondary whitespace-nowrap';
const INPUT = 'w-28 px-2 py-1.5 bg-surface-alt border border-border rounded-md text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-70';
const SIN_DATO = '—';

const usd = (n: number | null): string => (n === null ? SIN_DATO : `USD ${formatearPeso(n)}`);
const signo = (n: number): string => (n > 0 ? '+' : '');
const diferencia = (n: number | null): string => (n === null ? SIN_DATO : `${signo(n)}${usd(n)}`);
const porcentaje = (n: number | null): string => (n === null ? SIN_DATO : `${signo(n)}${formatearPeso(n)} %`);
const colorDiferencia = (n: number | null): string => (n === null || n === 0 ? '' : n > 0 ? 'text-green-700' : 'text-red-600');

const numericos = (textos: Record<string, string>) =>
  Object.fromEntries(Object.entries(textos).map(([lote, t]) => [lote, parsearValorKg(t)]));

function avisoFaltantes(comparados: number, incompletos: number): string {
  if (comparados === 0) return 'Aún no hay ningún lote con valor estimado y valor real; la comparación total queda en blanco.';
  if (incompletos === 0) return `El total compara los ${comparados} lotes.`;
  const lotes = incompletos === 1 ? 'lote no tiene' : 'lotes no tienen';
  return `El total compara solo ${comparados} lotes con ambos valores. ${incompletos} ${lotes} valor estimado o real y no se suman.`;
}

/** Resultados de la exportación (interno, no sale en el PDF): proyección inicial frente a lo realmente obtenido, por lote. */
function PackingListResultados({ kgs, valoracion, puedeEditar, onCambiarReal }: Props) {
  const resumen = useMemo(
    () => calcularResultados(kgs, numericos(valoracion.estimado), numericos(valoracion.real)),
    [kgs, valoracion]
  );

  if (kgs.length === 0) {
    return <p className="text-sm text-text-muted">Agrega paletas al detalle para comparar los resultados por lote.</p>;
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-sm tabular-nums">
          <thead>
            <tr className="border-b border-border">
              <th className={`${TH} text-left`}>Lote</th>
              <th className={`${TH} text-right`}>Neto (kg)</th>
              <th className={`${TH} text-right`}>Proyección (USD/kg)</th>
              <th className={`${TH} text-right`}>Real obtenido (USD/kg)</th>
              <th className={`${TH} text-right`}>Total proyectado</th>
              <th className={`${TH} text-right`}>Total real</th>
              <th className={`${TH} text-right`}>Diferencia (USD)</th>
              <th className={`${TH} text-right`}>Diferencia (%)</th>
            </tr>
          </thead>
          <tbody>
            {resumen.lineas.map(l => {
              const nombre = l.lote === '' ? 'Sin lote' : l.lote;
              const texto = valoracion.real[l.lote] ?? '';
              const invalido = texto.trim() !== '' && l.valorRealKgUsd === null;
              return (
                <tr key={l.lote} className="border-b border-border/60">
                  <td className="px-2 py-1.5">{nombre}</td>
                  <td className="px-2 py-1.5 text-right">{formatearPeso(l.kg)}</td>
                  <td className="px-2 py-1.5 text-right">{l.valorEstimadoKgUsd === null ? SIN_DATO : textoValorKg(l.valorEstimadoKgUsd)}</td>
                  <td className="px-2 py-1.5 text-right">
                    <input
                      aria-label={`Valor real obtenido por kg del lote ${nombre}`}
                      aria-invalid={invalido}
                      inputMode="decimal"
                      value={texto}
                      disabled={!puedeEditar}
                      onChange={e => onCambiarReal(l.lote, e.target.value)}
                      className={`${INPUT} ${invalido ? 'border-red-500' : ''}`}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right">{usd(l.estimadoUsd)}</td>
                  <td className="px-2 py-1.5 text-right">{usd(l.realUsd)}</td>
                  <td className={`px-2 py-1.5 text-right font-medium ${colorDiferencia(l.diferenciaUsd)}`}>{diferencia(l.diferenciaUsd)}</td>
                  <td className={`px-2 py-1.5 text-right font-medium ${colorDiferencia(l.diferenciaPct)}`}>{porcentaje(l.diferenciaPct)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td className="px-2 py-2" colSpan={4}>Total de lotes comparados</td>
              <td className="px-2 py-2 text-right">{usd(resumen.totalEstimadoUsd)}</td>
              <td className="px-2 py-2 text-right">{usd(resumen.totalRealUsd)}</td>
              <td className={`px-2 py-2 text-right ${colorDiferencia(resumen.diferenciaUsd)}`}>{diferencia(resumen.diferenciaUsd)}</td>
              <td className={`px-2 py-2 text-right ${colorDiferencia(resumen.diferenciaPct)}`}>{porcentaje(resumen.diferenciaPct)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-2 text-xs text-text-muted" role="status">
        {avisoFaltantes(resumen.lotesComparados, resumen.lotesIncompletos)} Diferencia = real menos proyectado; «{SIN_DATO}» significa que falta el dato.
      </p>
    </div>
  );
}

export default PackingListResultados;
