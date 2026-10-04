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
        ayuda="Suma de los kg de compras y ventas con fecha de hoy: el neto de los materiales en los tickets completos y el peso global en los que siguen en bruto. Los traslados no cuentan. Hoy es un día a medias: se compara contra el día de ayer completo."
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
        ayuda="Operaciones que ya se registraron pero falta confirmar: compras guardadas en bruto (se suma su peso global) y traslados pendientes (se suma lo enviado). Es el saldo de hoy, no tiene periodo anterior."
        estado={sinDatos && traslados.length === 0 ? 'vacio' : 'listo'}
        mensajeVacio="Aún no hay operaciones registradas"
        valor={kg(porRecepcionar.kgTotal)}
        unidad="kg"
        subtitulo={detallePendiente}
      />

      <TarjetaKpi
        titulo="Compras sin facturar"
        icono={<Receipt size={16} />}
        ayuda="Compras completas que todavía no tienen factura. No cuenta las que están en bruto (primero hay que completarlas) ni las unidas a otro ticket, que se facturan junto con el principal."
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
        ayuda="Tickets completos donde la báscula general y la suma de materiales no cuadran: la diferencia supera el 0,6 % del peso global, o los materiales pesan más que el global. No se mide en pesajes en báscula externa, tickets en bruto ni tickets unidos."
        estado={diferencias.medibles === 0 ? 'vacio' : 'listo'}
        mensajeVacio="Aún no hay tickets con peso global para medir"
        valor={formatearNumero(diferencias.fuera, 0)}
        unidad={plural(diferencias.fuera, 'ticket', 'tickets')}
        tonoValor={diferencias.fuera > 0 ? 'peligro' : 'normal'}
        subtitulo={diferencias.fuera === 0
          ? `Los ${diferencias.medibles} tickets medibles están dentro de la tolerancia`
          : `de ${diferencias.medibles} tickets medibles${diferencias.favoreceProveedor > 0 ? ` · ${diferencias.favoreceProveedor} con materiales sobre el global` : ''}`}
      />
    </GrillaKpis>
  );
}

export default ListaKpis;
