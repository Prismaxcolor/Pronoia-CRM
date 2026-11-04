import { Check } from 'lucide-react';
import { PASOS, type NumeroPaso } from './asistente';

interface Props {
  actual: NumeroPaso;
  /** Pasos a los que se puede saltar directamente (los demás se muestran sin enlace). */
  puedeIr: (paso: NumeroPaso) => boolean;
  onIr: (paso: NumeroPaso) => void;
}

/** Los tres pasos del asistente, siempre visibles; el actual resaltado y los anteriores marcados como hechos. */
function PasosIndicador({ actual, puedeIr, onIr }: Props) {
  return (
    <nav aria-label="Pasos de la exportación" className="mb-6">
      <ol className="grid gap-2 sm:grid-cols-3">
        {PASOS.map(p => {
          const esActual = p.numero === actual;
          const hecho = p.numero < actual;
          const clase = esActual ? 'border-brand-500 bg-brand-50 text-text-primary' : 'border-border bg-surface text-text-secondary';
          return (
            <li key={p.numero}>
              <button type="button" disabled={!puedeIr(p.numero)} onClick={() => onIr(p.numero)}
                aria-current={esActual ? 'step' : undefined}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-default ${clase}`}>
                <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${esActual || hecho ? 'bg-brand-600 text-white' : 'bg-surface-alt'}`}>
                  {hecho ? <Check size={14} /> : p.numero}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium">Paso {p.numero}: {p.titulo}</span>
                  <span className="block text-[11px] text-text-muted">{p.ayuda}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default PasosIndicador;
