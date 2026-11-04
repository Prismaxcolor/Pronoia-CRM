import { useEffect, useMemo, useState } from 'react';
import { vecinosPorCreacion, type DestinoVecino, type VecinosDocumento } from '../../lib/navegacion-documentos';
import { obtenerTickets } from '../../services/ticket-pesaje-service';
import type { TicketPesaje } from '@shared/types/index.js';

const SIN_VECINOS: VecinosDocumento<DestinoVecino> = { anterior: null, siguiente: null, posicion: null, total: 0 };

/** Ticket anterior / siguiente de la lista de Pesaje (por orden de creación) para los botones del detalle. Sin la lista no hay botones. */
export function useVecinosTicket(idActual: string): VecinosDocumento<DestinoVecino> {
  const [tickets, setTickets] = useState<TicketPesaje[] | null>(null);

  useEffect(() => {
    let vigente = true;
    obtenerTickets()
      .then(lista => { if (vigente) setTickets(lista); })
      .catch(() => { /* sin la lista no hay anterior/siguiente; el ticket se ve igual */ });
    return () => { vigente = false; };
  }, []);

  return useMemo(
    () => (tickets ? vecinosPorCreacion(tickets, t => ({ id: t.id, creadoEn: t.createdAt, numero: t.numero }), idActual, t => `/pesaje/${t.id}`) : SIN_VECINOS),
    [tickets, idActual],
  );
}
