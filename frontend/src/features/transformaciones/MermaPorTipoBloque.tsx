import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  ETIQUETAS_MERMA,
  TIPOS_MERMA,
  mermaSinClasificar,
  totalMermaTipificada,
  validarMermaForm,
  type MermaForm,
} from '../../lib/merma-tipificada';

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

interface Props {
  /** Merma calculada = peso neto de entrada - suma de netos de las salidas. */
  mermaKg: number;
  valores: MermaForm;
  onCambiar: (valores: MermaForm) => void;
}

/** Bloque OPCIONAL "Merma por tipo" para los modales de completar transformación.
 *  No cambia el flujo si se deja vacío; si se llena, no puede exceder la merma calculada. */
function MermaPorTipoBloque({ mermaKg, valores, onCambiar }: Props) {
  const [abierto, setAbierto] = useState(() => totalMermaTipificada(valores) > 0);
  const error = validarMermaForm(mermaKg, valores);
  const sinClasificar = mermaSinClasificar(mermaKg, valores);
  const hayMerma = mermaKg > 0.005;

  return (
    <div className="border border-border rounded-lg">
      <button
        type="button"
        onClick={() => setAbierto(a => !a)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-text-secondary hover:bg-surface-alt rounded-lg"
      >
        <span>
          Merma por tipo <span className="text-xs font-normal text-text-muted">(opcional)</span>
        </span>
        {abierto ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>
      {abierto && (
        <div className="px-3 pb-3 space-y-2">
          {!hayMerma ? (
            <p className="text-xs text-text-muted">No hay merma calculada: las salidas pesan lo mismo que la entrada.</p>
          ) : (
            <>
              <p className="text-xs text-text-muted">
                Merma calculada: <span className="font-medium text-text-secondary">{fmt(mermaKg)} kg</span>. Reparte los kilos que
                se perdieron por tipo; lo que no clasifiques queda como "sin clasificar".
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {TIPOS_MERMA.map(tipo => (
                  <div key={tipo}>
                    <label className="block text-[11px] font-medium text-text-secondary mb-1">{ETIQUETAS_MERMA[tipo]} (kg)</label>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      inputMode="decimal"
                      value={valores[tipo]}
                      onChange={e => onCambiar({ ...valores, [tipo]: e.target.value })}
                      className="w-full px-2.5 py-1.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                      placeholder="0.00"
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-muted">Sin clasificar</span>
                <span className="font-medium text-text-secondary">{fmt(sinClasificar)} kg</span>
              </div>
            </>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}

export default MermaPorTipoBloque;
