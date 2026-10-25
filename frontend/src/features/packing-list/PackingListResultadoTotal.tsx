import { useMemo } from 'react';
import { formatearPeso } from '../../lib/packing-list';
import { parsearValorKg, type KgLote } from '../../lib/proyeccion-packing';
import { calcularResultadoTotal, parsearTotalUsd, type ResumenResultados } from '../../lib/resultados-exportacion';
import type { ValoracionForm } from './formulario';

interface Props {
  kgs: KgLote[];
  valoracion: ValoracionForm;
  /** Comparación por lote ya calculada: es el «beneficio real» de respaldo cuando no hay total cobrado. */
  porLote: ResumenResultados;
  puedeEditar: boolean;
  onCambiarTotalReal: (texto: string) => void;
}

const SIN_DATO = '—';
const INPUT = 'w-44 px-2 py-1.5 bg-surface-alt border border-border rounded-md text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-70';

const usd = (n: number | null): string => (n === null ? SIN_DATO : `USD ${formatearPeso(n)}`);
const signo = (n: number): string => (n > 0 ? '+' : '');
const diferencia = (n: number | null): string => (n === null ? SIN_DATO : `${signo(n)}${usd(n)}`);
const porcentaje = (n: number | null): string => (n === null ? SIN_DATO : `${signo(n)}${formatearPeso(n)} %`);
const colorDiferencia = (n: number | null): string => (n === null || n === 0 ? '' : n > 0 ? 'text-green-700' : 'text-red-600');

function Cifra({ etiqueta, valor, className = '' }: { etiqueta: string; valor: string; className?: string }) {
  return (
    <div>
      <dt className="text-xs text-text-secondary">{etiqueta}</dt>
      <dd className={`text-sm font-semibold tabular-nums ${className}`}>{valor}</dd>
    </div>
  );
}

/** Qué se toma como beneficio real: el total cobrado si existe; si no, la suma de los lotes comparados. */
function textoBeneficioReal(totalReal: number | null, porLote: ResumenResultados): string {
  if (totalReal !== null) return `Beneficio real: ${usd(totalReal)} (total cobrado de la exportación).`;
  if (porLote.totalRealUsd !== null) {
    return `Beneficio real: ${usd(porLote.totalRealUsd)} (suma de los lotes con valor real; aún no hay un total cobrado).`;
  }
  return `Beneficio real: ${SIN_DATO} (aún no se ha cargado ni un total cobrado ni valores reales por lote).`;
}

/**
 * Comparación TOTAL de la exportación (interna, no sale en el PDF): la proyección total (suma de los lotes con
 * estimado) frente al total realmente cobrado, que se escribe a mano. Nunca se reparte por lote.
 */
function PackingListResultadoTotal({ kgs, valoracion, porLote, puedeEditar, onCambiarTotalReal }: Props) {
  const totalReal = parsearTotalUsd(valoracion.totalReal);
  const invalido = valoracion.totalReal.trim() !== '' && totalReal === null;
  const estimados = useMemo(
    () => Object.fromEntries(Object.entries(valoracion.estimado).map(([lote, t]) => [lote, parsearValorKg(t)])),
    [valoracion.estimado]
  );
  const r = useMemo(() => calcularResultadoTotal(kgs, estimados, totalReal), [kgs, estimados, totalReal]);

  return (
    <section aria-label="Comparación total de la exportación">
      <h3 className="text-sm font-semibold text-text-primary">Total de la exportación (proyección total frente a lo cobrado)</h3>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-text-secondary">
          Total real cobrado de la exportación (USD)
          <input
            inputMode="decimal"
            value={valoracion.totalReal}
            disabled={!puedeEditar}
            aria-invalid={invalido}
            placeholder="Ej.: 13.193,46"
            onChange={e => onCambiarTotalReal(e.target.value)}
            className={`${INPUT} mt-1 block ${invalido ? 'border-red-500' : ''}`}
          />
        </label>
        {invalido && <p role="alert" className="text-xs text-red-600">Monto no válido: usa máximo 2 decimales.</p>}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Cifra etiqueta="Proyección total" valor={usd(r.estimadoUsd)} />
        <Cifra etiqueta="Total real cobrado" valor={usd(r.realUsd)} />
        <Cifra etiqueta="Diferencia (USD)" valor={diferencia(r.diferenciaUsd)} className={colorDiferencia(r.diferenciaUsd)} />
        <Cifra etiqueta="Diferencia (%)" valor={porcentaje(r.diferenciaPct)} className={colorDiferencia(r.diferenciaPct)} />
      </dl>
      <p className="mt-2 text-xs text-text-muted" role="status">
        {r.lotesSinEstimar > 0 && r.estimadoUsd !== null
          ? `La proyección total suma solo los lotes con valor estimado (${r.lotesSinEstimar === 1 ? 'falta 1 lote' : `faltan ${r.lotesSinEstimar} lotes`}). `
          : ''}
        Diferencia = total cobrado menos proyección total; «{SIN_DATO}» significa que falta el dato.
      </p>
      <p className="mt-1 text-sm font-medium text-text-primary">{textoBeneficioReal(totalReal, porLote)}</p>
    </section>
  );
}

export default PackingListResultadoTotal;
