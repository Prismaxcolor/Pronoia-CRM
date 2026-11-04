import type { Banca } from '@shared/types/index.js';
import { alternarCuenta, etiquetaMoneda } from './reporte-wallet-datos';

interface Props {
  bancas: readonly Banca[];
  cargando: boolean;
  /** Ids de las cuentas elegidas. */
  seleccion: readonly string[];
  onCambiar: (ids: string[]) => void;
}

const CAJA = 'h-4 w-4 accent-brand-600';

/** Elige una, varias o todas las cuentas y cajas de un reporte. */
function SelectorCuentasReporte({ bancas, cargando, seleccion, onCambiar }: Props) {
  const todas = bancas.length > 0 && seleccion.length === bancas.length;
  return (
    <fieldset className="min-w-[14rem] flex-1" aria-busy={cargando}>
      <legend className="mb-1 block text-xs font-medium text-text-secondary">Cuentas o cajas</legend>
      {cargando ? (
        <p className="text-sm text-text-muted">Cargando cuentas…</p>
      ) : (
        <div className="max-h-44 overflow-y-auto rounded-lg border border-border bg-surface p-2">
          <label className="flex cursor-pointer items-center gap-2 border-b border-border px-1 pb-2 text-sm font-medium text-text-primary">
            <input type="checkbox" className={CAJA} checked={todas} onChange={() => onCambiar(todas ? [] : bancas.map(b => b.id))} />
            Todas las cuentas
          </label>
          {bancas.map(b => (
            <label key={b.id} className="flex cursor-pointer items-center gap-2 px-1 py-1.5 text-sm text-text-primary">
              <input type="checkbox" className={CAJA} checked={seleccion.includes(b.id)} onChange={() => onCambiar(alternarCuenta(seleccion, b.id))} />
              {b.nombre} ({etiquetaMoneda(b.moneda)}){b.archivada ? ' · archivada' : ''}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

export default SelectorCuentasReporte;
