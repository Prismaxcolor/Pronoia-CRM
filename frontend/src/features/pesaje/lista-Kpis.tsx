import { useMemo } from 'react';
import { AlertTriangle, PackageOpen, Receipt, Scale } from 'lucide-react';
import { GrillaKpis, SkeletonKpis, TarjetaKpi, formatearNumero } from '../../components/ui';
import type { TicketPesaje, Traslado } from '@shared/types/index.js';
import { comprasSinFacturar, kgHoyVsAyer, resumenDiferencias, resumenPorRecepcionar } from '../../lib/pesaje-kpis';

interface Props {
  tickets: readonly TicketPesaje[];
  traslados: readonly Traslado[];
  cargando: boolean;
  /** Fecha de hoy (AAAA-MM-DD, reloj local). */
  hoyIso: string;
  puedeVerFacturacion: boolean;
}

const kg = (n: number) => formatearNumero(n, 0);
const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

/** Cuatro indicadores de la lista de Pesaje. Todo sale de /api/tickets-pesaje y /api/traslados (ya cargados por la pantalla). */
function ListaKpis({ tickets, traslados, cargando, hoyIso, puedeVerFacturacion }: Props) {
  const hoyAyer = useMemo(() => kgHoyVsAyer(tickets, hoyIso), [tickets, hoyIso]);
  const porRecepcionar = useMemo(() => resumenPorRecepcionar(tickets, traslados), [tickets, traslados]);
  const sinFacturar = useMemo(() => comprasSinFacturar(tickets), [tickets]);
  const diferencias = useMemo(() => resumenDiferencias(tickets), [tickets]);

  if (cargando) return <SkeletonKpis />;
  const sinDatos = tickets.length === 0;

  const pendientes = porRecepcionar.ticketsBruto + porRecepcionar.trasladosPendientes;
  const detallePendiente = pendientes === 0
    ? 'Nada pendiente: todo está recepcionado'
    : [
      porRecepcionar.ticketsBruto > 0 ? `${porRecepcionar.ticketsBruto} ${plural(porRecepcionar.ticketsBruto, 'ticket en bruto', 'tickets en bruto')}` : null,
      porRecepcionar.trasladosPendientes > 0 ? `${porRecepcionar.trasladosPendientes} ${plural(porRecepcionar.trasladosPendientes, 'traslado pendiente', 'traslados pendientes')}` : null,
    ].filter(Boolean).join(' y ');

  return (
    <GrillaKpis>
      <TarjetaKpi
        titulo="Kg pesados hoy"
        icono={<Scale size={16} />}
        ayuda="Kg de las compras y ventas con fecha de hoy. De cada ticket completo se suma el peso neto de sus materiales (sin la tara); de cada ticket en bruto, que aún no tiene materiales, se suma el peso global del camión. Los traslados entre almacenes no cuentan. Hoy todavía no termina, por eso se compara con el día de ayer completo."
        estado={sinDatos ? 'vacio' : 'listo'}
        mensajeVacio="Aún no hay pesajes registrados"
        valor={kg(hoyAyer.hoy)}
        unidad="kg"
        subtitulo={hoyAyer.ticketsHoy === 0
          ? 'Aún no hay pesajes hoy'
          : `${hoyAyer.ticketsHoy} ${plural(hoyAyer.ticketsHoy, 'ticket', 'tickets')} de compra y venta hoy`}
        comparacion={sinDatos ? undefined : hoyAyer.comparacion}
        formatoDelta={d => `${kg(d)} kg`}
      >
        <p className="mt-0.5 text-xs text-text-secondary">
          {hoyAyer.comparacion ? `Ayer: ${kg(hoyAyer.ayer)} kg` : 'Sin historial comparable: ayer no hubo pesajes'}
        </p>
      </TarjetaKpi>

      <TarjetaKpi
        titulo="Por recepcionar"
        icono={<PackageOpen size={16} />}
        ayuda="Kg de lo que ya se pesó o se envió pero falta confirmar. Suma el peso global de los tickets en bruto (camión pesado, pero aún sin los materiales registrados) y los kg enviados en traslados pendientes (que el almacén destino todavía no recibe). Muestra la situación actual de todos los registros, sin comparar con otro periodo."
        estado={sinDatos && traslados.length === 0 ? 'vacio' : 'listo'}
        mensajeVacio="Aún no hay operaciones registradas"
        valor={kg(porRecepcionar.kgTotal)}
        unidad="kg"
        subtitulo={detallePendiente}
      />

      <TarjetaKpi
        titulo="Compras sin facturar"
        icono={<Receipt size={16} />}
        ayuda="Cantidad de compras ya completas (con sus materiales registrados) a las que todavía no se les hizo factura. Los kg de abajo son el peso neto de esas compras. No cuenta las compras en bruto, porque primero hay que completarlas, ni los tickets unidos a otro, que se facturan junto con el ticket principal."
        estado={!puedeVerFacturacion ? 'sinPermiso' : sinDatos ? 'vacio' : 'listo'}
        mensajeVacio="Aún no hay compras registradas"
        valor={formatearNumero(sinFacturar.cantidad, 0)}
        unidad={plural(sinFacturar.cantidad, 'compra', 'compras')}
        subtitulo={sinFacturar.cantidad === 0
          ? 'Todas las compras completas tienen factura'
          : `${kg(sinFacturar.kg)} kg por facturar`}
      >
        {sinFacturar.enBruto > 0 && (
          <p className="mt-0.5 text-xs text-text-secondary">
            Además, {sinFacturar.enBruto} {plural(sinFacturar.enBruto, 'compra en bruto', 'compras en bruto')} aún no se puede{sinFacturar.enBruto === 1 ? '' : 'n'} facturar
          </p>
        )}
      </TarjetaKpi>

      <TarjetaKpi
        titulo="Diferencia fuera de tolerancia"
        icono={<AlertTriangle size={16} />}
        ayuda="Cantidad de tickets completos cuyo peso global (el camión completo en la báscula) no cuadra con los materiales registrados. Se cuenta un ticket cuando la diferencia (peso global menos materiales menos devolución) supera el 0,6 % del peso global, por ejemplo más de 6 kg en 1.000 kg, o cuando los materiales suman más kg que el peso global. No se revisan los tickets en bruto, los pesados en báscula externa ni los unidos a otro ticket."
        estado={diferencias.medibles === 0 ? 'vacio' : 'listo'}
        mensajeVacio="Aún no hay tickets con peso global para medir"
        valor={formatearNumero(diferencias.fuera, 0)}
        unidad={plural(diferencias.fuera, 'ticket', 'tickets')}
        tonoValor={diferencias.fuera > 0 ? 'peligro' : 'normal'}
        subtitulo={diferencias.fuera === 0
          ? `Los ${diferencias.medibles} tickets medibles están dentro de la tolerancia`
          : `de ${diferencias.medibles} tickets medibles${diferencias.favoreceProveedor > 0 ? ` · ${diferencias.favoreceProveedor} con materiales por encima del peso global` : ''}`}
      />
    </GrillaKpis>
  );
}

export default ListaKpis;
