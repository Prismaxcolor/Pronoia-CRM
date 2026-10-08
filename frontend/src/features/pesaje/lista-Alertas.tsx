import { useMemo } from 'react';
import { Bloque, ListaAlertas, type AlertaDatos } from '../../components/ui';
import type { TicketPesaje } from '@shared/types/index.js';
import { brutosAntiguos, estadoDiferencia, HORAS_BRUTO_ALERTA, textoAntiguedad } from '../../lib/pesaje-kpis';

interface Props {
  tickets: readonly TicketPesaje[];
  /** Reloj de la pantalla (se pasa de afuera para no leer la hora en cada render). */
  ahora: Date;
}

const MAX_CODIGOS = 4;

function listarCodigos(codigos: readonly string[]): string {
  const visibles = codigos.slice(0, MAX_CODIGOS).join(', ');
  return codigos.length > MAX_CODIGOS ? `${visibles} y ${codigos.length - MAX_CODIGOS} más` : visibles;
}

/** Alertas de la lista de Pesaje: tickets por recepcionar sin completar y diferencias de peso fuera de tolerancia.
 *  (Las tomas físicas abiertas se avisan arriba de toda la pantalla, en las dos pestañas.)
 *  Rojo solo cuando los materiales superan al peso global (se pagaría peso que la báscula nunca confirmó). */
function ListaAlertasPesaje({ tickets, ahora }: Props) {
  const alertas = useMemo(() => {
    const salida: AlertaDatos[] = [];

    const brutos = brutosAntiguos(tickets, ahora);
    if (brutos.length > 0) {
      salida.push({
        id: 'brutos-antiguos',
        severidad: 'amarilla',
        texto: `${brutos.length} ${brutos.length === 1 ? 'ticket lleva' : 'tickets llevan'} más de ${HORAS_BRUTO_ALERTA} h por recepcionar sin completarse`,
        detalle: `${listarCodigos(brutos.map(b => b.codigo))}. El más antiguo lleva ${textoAntiguedad(brutos[0].horas)} desde que se registró. Por recepcionar significa que se pesó el camión pero faltan los materiales; hasta completarlo no entra al inventario.`,
        enlace: { to: '?estado=bruto', etiqueta: 'Ver por recepcionar' },
      });
    }

    const favorecen = tickets.filter(t => estadoDiferencia(t) === 'favorece_proveedor');
    if (favorecen.length > 0) {
      salida.push({
        id: 'dif-favorece',
        severidad: 'roja',
        texto: `${favorecen.length} ${favorecen.length === 1 ? 'ticket tiene' : 'tickets tienen'} materiales que pesan más que el peso global`,
        detalle: `${listarCodigos(favorecen.map(t => t.codigo))}. Los materiales suman más kg que el peso global (después de restar la devolución). Revisa los pesos: se estaría pagando peso que la báscula general no confirmó.`,
        enlace: { to: '?dif=1', etiqueta: 'Ver estos tickets' },
      });
    }

    const fuera = tickets.filter(t => estadoDiferencia(t) === 'fuera');
    if (fuera.length > 0) {
      salida.push({
        id: 'dif-fuera',
        severidad: 'amarilla',
        texto: `${fuera.length} ${fuera.length === 1 ? 'ticket tiene' : 'tickets tienen'} una diferencia de peso fuera de tolerancia`,
        detalle: `${listarCodigos(fuera.map(t => t.codigo))}. El peso global es mayor que los materiales en más del 0,6 % (merma o peso sin clasificar).`,
        enlace: { to: '?dif=1', etiqueta: 'Ver estos tickets' },
      });
    }
    return salida;
  }, [tickets, ahora]);

  return (
    <Bloque titulo="Alertas" queEstasViendo="lo que conviene revisar: tickets por recepcionar con más de 24 horas sin completar, y tickets cuyo peso global no cuadra con la suma de sus materiales (más del 0,6 % de diferencia, o materiales por encima del peso global).">
      <ListaAlertas alertas={alertas} />
    </Bloque>
  );
}

export default ListaAlertasPesaje;
