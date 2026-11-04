import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { obtenerTickets } from '../../services/ticket-pesaje-service';
import { Bloque, EstadoVacio, formatearFecha, formatearKgDecimales } from '../../components/ui';
import { ticketsPendientesDeFacturar } from '../../lib/tickets-facturables';
import type { TicketPesaje } from '@shared/types/index.js';

interface Props {
  /** Proveedores para mostrar el nombre (id -> nombre). */
  nombresProveedor: ReadonlyMap<string, string>;
  /** Si es false no se muestra el botón de facturar (sin permiso de crear). */
  puedeFacturar: boolean;
}

/** Tickets de compra completos que aún no tienen factura, con acceso directo a facturarlos. */
function PesajesPendientesFacturar({ nombresProveedor, puedeFacturar }: Props) {
  const [tickets, setTickets] = useState<TicketPesaje[] | null>(null);

  useEffect(() => {
    let cancelado = false;
    void obtenerTickets({ soloNoFacturados: true, tipo: 'compra', estado: 'completo' })
      .then(lista => { if (!cancelado) setTickets(ticketsPendientesDeFacturar(lista, 'compra')); })
      .catch(() => { if (!cancelado) setTickets([]); });
    return () => { cancelado = true; };
  }, []);

  const pendientes = useMemo(() => tickets ?? [], [tickets]);
  if (tickets === null || pendientes.length === 0) {
    return tickets === null ? null : (
      <Bloque titulo="Pesajes pendientes por facturar" queEstasViendo="los tickets de pesaje de compra ya completados que todavía no tienen factura.">
        <EstadoVacio mensaje="No hay pesajes pendientes por facturar." />
      </Bloque>
    );
  }

  return (
    <Bloque
      titulo="Pesajes pendientes por facturar"
      queEstasViendo={`${pendientes.length} ${pendientes.length === 1 ? 'ticket de pesaje de compra completo' : 'tickets de pesaje de compra completos'} sin factura. Los pesajes globales sin completar no aparecen aquí.`}
    >
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {pendientes.map(t => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <div className="min-w-0">
              <Link to={`/pesaje/${t.id}`} className="font-medium text-brand-700 hover:underline">{t.codigo}</Link>
              <span className="text-text-secondary"> · {t.entidadId ? (nombresProveedor.get(t.entidadId) ?? 'Proveedor') : '—'} · {t.fecha ? formatearFecha(t.fecha) : '—'} · {formatearKgDecimales(t.pesoNetoTotal)}</span>
            </div>
            {puedeFacturar && t.entidadId && (
              <Link
                to={`/compras/nueva?entidad=${encodeURIComponent(t.entidadId)}&ticket=${encodeURIComponent(t.id)}`}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
              >
                Facturar
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Bloque>
  );
}

export default PesajesPendientesFacturar;
