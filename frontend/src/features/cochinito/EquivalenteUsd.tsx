import { equivalentesDeBs } from '../../../../shared/types/equivalente-usd.js';
import { textoLineaEquivalente, type EstadoTasasUsd } from './equivalente-usd';

interface Props {
  /** Monto en bolívares del que se muestra el equivalente. */
  montoBs: number;
  estado: EstadoTasasUsd;
}

/** Equivalente en USD de un monto en Bs a tasa Binance y a tasa BCV (dos líneas). Solo informativo: no se guarda. */
function EquivalenteUsd({ montoBs, estado }: Props) {
  if (!(montoBs > 0)) return null;
  if (estado.cargando) return <p className="mt-1 text-xs text-text-muted">Cargando las tasas para el equivalente en USD…</p>;
  const lineas = equivalentesDeBs(montoBs, estado.tasas);
  return (
    <div className="mt-1 space-y-0.5 text-xs text-text-secondary" aria-live="polite">
      {lineas.map(l => <p key={l.fuente} className={l.usd === null ? 'text-amber-800' : undefined}>{textoLineaEquivalente(l)}</p>)}
    </div>
  );
}

export default EquivalenteUsd;
