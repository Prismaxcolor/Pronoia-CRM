import type { TicketPesaje } from '@shared/types/index.js';

interface Props {
  tickets: TicketPesaje[];
  onContinuar: (ticket: TicketPesaje) => void;
}

/** Pesajes globales por recepcionar del proveedor elegido, para continuarlos (completarlos)
 *  en vez de crear otro pesaje nuevo. No se muestra si no hay ninguno. */
function TicketsBrutoProveedor({ tickets, onContinuar }: Props) {
  if (tickets.length === 0) return null;
  return (
    <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 space-y-2">
      <p className="text-xs font-medium text-amber-800">
        Este proveedor tiene {tickets.length === 1 ? 'un ticket pendiente' : `${tickets.length} tickets pendientes`} por completar:
      </p>
      <ul className="space-y-1">
        {tickets.map(t => (
          <li key={t.id} className="flex items-center justify-between gap-2 text-xs text-amber-900">
            <span className="truncate">{t.codigo}{t.fecha ? ` · ${t.fecha}` : ''}{t.pesoGlobal > 0 ? ` · ${t.pesoGlobal} kg global` : ''}</span>
            <button
              type="button"
              onClick={() => onContinuar(t)}
              className="shrink-0 px-2 py-1 rounded-md border border-amber-400 bg-white font-medium hover:bg-amber-100"
            >
              Continuar
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default TicketsBrutoProveedor;
