import { AlertTriangle } from 'lucide-react';
import { formatearPeso } from '../../lib/packing-list';
import type { ControlDisponible } from '../../lib/lotes-packing';

interface Props {
  control: readonly ControlDisponible[];
}

const TH = 'px-2 py-2 text-left text-xs font-semibold text-text-secondary whitespace-nowrap';

/**
 * Kg de este packing list frente a los kg disponibles del lote en su almacén. CONTROL INTERNO: no sale en los PDF
 * y solo avisa (el cliente decide); no descuenta ni mueve inventario.
 */
function PackingListControlLotes({ control }: Props) {
  const excedidos = control.filter(c => c.excede);
  const sinLeer = control.filter(c => c.disponibilidadNoLeida);
  if (control.length === 0) return <p className="text-sm text-text-muted">Elige el lote de las paletas para ver aquí cuánto hay disponible.</p>;
  return (
    <div>
      {excedidos.length > 0 && (
        <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            {excedidos.length === 1 ? 'Un lote supera' : `${excedidos.length} lotes superan`} lo disponible en inventario. Puedes guardar igual:
            revisa si faltan registrar movimientos de inventario.
          </p>
        </div>
      )}
      {sinLeer.length > 0 && (
        <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-text-secondary">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>No se pudo leer la disponibilidad de {sinLeer.length === 1 ? 'un lote' : `${sinLeer.length} lotes`}: no se compara con el inventario. Recarga la página para reintentar.</p>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>Lote</th>
              <th className={TH}>Almacén</th>
              <th className={`${TH} text-right`}>En este packing (kg)</th>
              <th className={`${TH} text-right`}>Disponible (kg)</th>
              <th className={TH}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {control.map(c => (
              <tr key={`${c.lote}|${c.almacenId ?? ''}`} className="border-b border-border/60">
                <td className="px-2 py-1.5 font-medium">{c.lote}</td>
                <td className="px-2 py-1.5">{c.almacenNombre ?? <span className="text-text-muted">—</span>}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatearPeso(c.usadoKg)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {c.disponibleKg === null ? <span className="text-text-muted">—</span> : formatearPeso(c.disponibleKg)}
                </td>
                <td className="px-2 py-1.5 text-xs">
                  {c.disponibilidadNoLeida && <span className="font-medium text-amber-800">No se pudo leer la disponibilidad</span>}
                  {c.disponibleKg === null && !c.disponibilidadNoLeida && <span className="text-text-muted">Lote guardado antes: sin comparar</span>}
                  {c.disponibleKg !== null && !c.excede && <span className="text-emerald-700">Dentro de lo disponible</span>}
                  {c.excede && <span className="font-medium text-amber-800">Excede por {formatearPeso(c.excesoKg)} kg</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default PackingListControlLotes;
