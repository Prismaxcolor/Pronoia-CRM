import { AlertTriangle } from 'lucide-react';
import type { Almacen } from '@shared/types/index.js';
import { INPUT_CLASS, LABEL_CLASS } from './pesaje-clases';

interface Props {
  tipo: 'compra' | 'venta';
  almacenes: Almacen[];
  almacenPredeterminado: Almacen | undefined;
  almacenOrigenId: string;
  setAlmacenOrigenId: (id: string) => void;
}

/** Almacén de una compra o venta: selector si hay varios, texto fijo si hay uno predeterminado, aviso si no hay ninguno. */
function AlmacenDelPesaje({ tipo, almacenes, almacenPredeterminado, almacenOrigenId, setAlmacenOrigenId }: Props) {
  if (almacenes.length > 1) {
    return (
      <div>
        <label className={LABEL_CLASS}>Almacén</label>
        <select
          value={almacenOrigenId || almacenPredeterminado?.id || ''}
          onChange={e => setAlmacenOrigenId(e.target.value)}
          className={INPUT_CLASS}
        >
          {almacenes.map(a => (
            <option key={a.id} value={a.id}>
              {a.nombre}{a.esPredeterminado ? ' (predeterminado)' : ''}
            </option>
          ))}
        </select>
        <p className="text-xs text-text-muted mt-1">
          {tipo === 'compra'
            ? 'Esta compra entra al inventario de este almacén. No limita ni bloquea nada, es solo para saber dónde quedó el material.'
            : 'Esta venta sale del inventario de este almacén. No limita ni bloquea nada, es solo para saber de dónde salió el material.'}
        </p>
      </div>
    );
  }
  if (almacenPredeterminado) {
    return (
      <div className="select-none px-3 py-2 bg-surface-alt border border-border rounded-lg">
        <p className="text-sm font-medium text-text-primary">Almacén: {almacenPredeterminado.nombre}</p>
        <p className="text-xs text-text-muted mt-0.5">
          {tipo === 'compra'
            ? 'Esta compra entra al inventario de este almacén.'
            : 'Esta venta sale del inventario de este almacén.'}
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-800">
      <AlertTriangle size={15} className="shrink-0 mt-0.5" />
      <p className="text-xs">Ningún almacén está marcado como predeterminado — este pesaje no afectará a ningún almacén.</p>
    </div>
  );
}

export default AlmacenDelPesaje;
