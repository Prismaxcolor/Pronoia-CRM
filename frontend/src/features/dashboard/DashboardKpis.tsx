import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Landmark, PiggyBank, RefreshCw, Scale, Ticket } from 'lucide-react';
import type { RespuestaSaldos } from '@shared/types/saldos.js';
import { GrillaKpis, TarjetaKpi, formatearFecha, formatearKg, formatearNumero, formatearPct, formatearUsd } from '../../components/ui';
import { compararKg, formatoDeltaConPct, contarCompras, periodoAnteriorComparable, sumarKg, type BancaMinima, type ResumenTickets, saldosPorMoneda } from '../../lib/dashboard-kpis';
import type { EstadoBloque } from './useDashboardCarga';
import type { SemanasKg } from './dashboardFuentes';
import { formatearHoraNegocio } from '../../lib/fecha-negocio';

/** Los cuatro indicadores del Dashboard. Cada tarjeta carga y falla sola y comprueba SU permiso. */
export interface DashboardKpisProps {
  semanas: EstadoBloque<SemanasKg> & { recargar: () => void };
  saldos: EstadoBloque<RespuestaSaldos> & { recargar: () => void };
  tickets: EstadoBloque<ResumenTickets> & { recargar: () => void };
  bancas: EstadoBloque<BancaMinima[]> & { recargar: () => void };
  puedeFacturar: boolean;
}

/** Tarjeta de error con la misma forma que TarjetaKpi y un botón para reintentar (TarjetaKpi no tiene estado de error). */
function TarjetaKpiError({ titulo, mensaje, onReintentar }: { titulo: string; mensaje: string; onReintentar: () => void }) {
  return (
    <article className="rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
      <h3 className="mb-2 text-sm font-medium text-text-secondary">{titulo}</h3>
      <p className="text-sm font-medium text-red-800">No se pudo cargar</p>
      <p className="text-xs text-red-800">{mensaje}</p>
      <button type="button" onClick={onReintentar} className="mt-2 flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
        <RefreshCw size={14} aria-hidden="true" /> Reintentar
      </button>
    </article>
  );
}

type Estado<T> = EstadoBloque<T> & { recargar: () => void };

/** Resuelve los estados no-listos de una tarjeta. Devuelve null cuando hay dato y se debe dibujar el valor. */
function tarjetaNoLista<T>(e: Estado<T>, titulo: string, icono: ReactNode, ayuda: ReactNode, textoSinPermiso: { dinero: boolean; mensaje: string }): ReactNode | null {
  if (e.estado === 'listo') return null;
  if (e.estado === 'error') return <TarjetaKpiError titulo={titulo} mensaje={e.mensaje} onReintentar={e.recargar} />;
  if (e.estado === 'sinPermiso') {
    return textoSinPermiso.dinero
      ? <TarjetaKpi titulo={titulo} icono={icono} ayuda={ayuda} estado="sinPermiso" />
      : <TarjetaKpi titulo={titulo} icono={icono} ayuda={ayuda} estado="vacio" mensajeVacio={textoSinPermiso.mensaje} />;
  }
  return <TarjetaKpi titulo={titulo} icono={icono} ayuda={ayuda} estado="cargando" />;
}

function KpiKgSemana({ semanas }: { semanas: Estado<SemanasKg> }) {
  const titulo = 'Kg comprados (7 días)';
  const icono = <Scale size={16} />;
  const ayuda = 'Kilos (kg) de todas las compras confirmadas en los últimos 7 días, contando hoy. No se cuentan las compras en borrador ni las anuladas, y cada compra cae en la fecha de su factura. Se compara con los 7 días justo antes; si esa semana no tuvo compras o empezó antes del 17/09/2026 (cuando comenzó el registro real), dice «sin historial comparable» porque el porcentaje sería engañoso.';
  const pendiente = tarjetaNoLista(semanas, titulo, icono, ayuda, { dinero: false, mensaje: 'Sin permiso para ver compras' });
  if (pendiente || semanas.estado !== 'listo') return pendiente;

  const { rangos, actual, anterior } = semanas.dato;
  const kg = sumarKg(actual);
  const comparable = periodoAnteriorComparable(rangos.anterior.desde, anterior.length);
  const cmp = compararKg(kg, sumarKg(anterior), comparable);
  return (
    <TarjetaKpi
      titulo={titulo}
      icono={icono}
      ayuda={ayuda}
      estado={actual.length === 0 ? 'vacio' : 'listo'}
      mensajeVacio="Sin compras confirmadas en los últimos 7 días"
      valor={formatearNumero(kg, 0)}
      unidad="kg"
      subtitulo={`${formatearFecha(rangos.actual.desde)} al ${formatearFecha(rangos.actual.hasta)} · ${contarCompras(actual)} compras`}
      comparacion={cmp ?? undefined}
      formatoDelta={formatoDeltaConPct(cmp, formatearKg, p => formatearPct(p, 1))}
    >
      {!cmp && <p className="mt-2 text-xs text-text-muted">Sin historial comparable: la semana anterior no tiene compras o empieza antes del 17/09/2026, cuando comenzó el registro real.</p>}
    </TarjetaKpi>
  );
}

function KpiPorPagar({ saldos }: { saldos: Estado<RespuestaSaldos> }) {
  const titulo = 'Por pagar a proveedores';
  const icono = <Landmark size={16} />;
  const ayuda = 'Total en USD que se les debe a los proveedores. De cada proveedor se toman sus facturas (menos las anuladas) y notas de débito, y se restan sus pagos, adelantos y notas de crédito. Solo se suman los proveedores a quienes se les debe (saldo mayor a 0). Es la misma cifra del estado de cuenta de cada proveedor y se vuelve a calcular cada ~20 segundos.';
  const pendiente = tarjetaNoLista(saldos, titulo, icono, ayuda, { dinero: true, mensaje: '' });
  if (pendiente || saldos.estado !== 'listo') return pendiente;

  const { totales, saldos: lista, calculadoEn } = saldos.dato;
  const conDeuda = lista.filter(s => s.saldo > 0).length;
  const hora = formatearHoraNegocio(calculadoEn);
  return (
    <TarjetaKpi titulo={titulo} icono={icono} ayuda={ayuda} valor={formatearUsd(totales.porPagar ?? 0)} subtitulo={`${conDeuda} ${conDeuda === 1 ? 'proveedor con saldo' : 'proveedores con saldo'} · calculado ${hora}`} comparacion={null}>
      {totales.aFavor > 0 && <p className="mt-1 text-xs text-text-muted">Aparte, {formatearUsd(totales.aFavor)} a favor: proveedores a quienes se les pagó o adelantó de más. Esa cifra no se resta del total por pagar.</p>}
      <p className="mt-1 text-xs"><Link to="/proveedores" className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Ver proveedores →</Link></p>
    </TarjetaKpi>
  );
}

function KpiTickets({ tickets, puedeFacturar }: { tickets: Estado<ResumenTickets>; puedeFacturar: boolean }) {
  const titulo = 'Tickets pendientes';
  const icono = <Ticket size={16} />;
  const ayuda = 'Por recepcionar: compras ya pesadas pero todavía «por recepcionar», es decir sin completar; mientras estén así no suman al inventario ni se pueden facturar. Sin facturar: compras ya completas que aún no tienen factura (un ticket unido a otro no se cuenta aparte).';
  const pendiente = tarjetaNoLista(tickets, titulo, icono, ayuda, { dinero: false, mensaje: 'Sin permiso para ver pesajes' });
  if (pendiente || tickets.estado !== 'listo') return pendiente;

  const t = tickets.dato;
  return (
    <TarjetaKpi
      titulo={titulo}
      icono={icono}
      ayuda={ayuda}
      valor={formatearNumero(t.porRecepcionar, 0)}
      unidad="por recepcionar"
      subtitulo="pesajes globales por recepcionar"
      comparacion={null}
    >
      <p className="mt-1 text-xs text-text-secondary">
        <span className="tabular-nums font-medium">{formatearNumero(t.sinFacturar, 0)}</span> {t.sinFacturar === 1 ? 'compra completa sin facturar' : 'compras completas sin facturar'}
      </p>
      <p className="mt-1 flex flex-wrap gap-x-3 text-xs">
        <Link to="/pesaje" className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Ver pesajes →</Link>
        {puedeFacturar && t.sinFacturar > 0 && <Link to="/compras/nueva" className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Facturar →</Link>}
      </p>
    </TarjetaKpi>
  );
}

function KpiCochinito({ bancas }: { bancas: Estado<BancaMinima[]> }) {
  const titulo = 'Saldo del wallet';
  const icono = <PiggyBank size={16} />;
  const ayuda = 'Dinero que hay ahora en las bancas activas (no archivadas) del wallet. Se suma por moneda: los dólares (USD) y los bolívares (VES) nunca se mezclan. El saldo de cada banca es lo que entró (ingresos y transferencias recibidas) menos lo que salió (egresos y transferencias enviadas); puede dar negativo si salió más de lo que se registró como entrada.';
  const pendiente = tarjetaNoLista(bancas, titulo, icono, ayuda, { dinero: true, mensaje: '' });
  if (pendiente || bancas.estado !== 'listo') return pendiente;

  const s = saldosPorMoneda(bancas.dato);
  if (!s.hayUsd && !s.hayVes) {
    return <TarjetaKpi titulo={titulo} icono={icono} ayuda={ayuda} estado="vacio" mensajeVacio="No hay bancas activas en el wallet" />;
  }
  return (
    <TarjetaKpi
      titulo={titulo}
      icono={icono}
      ayuda={ayuda}
      valor={s.hayUsd ? formatearUsd(s.usd) : `Bs ${formatearNumero(s.ves, 2)}`}
      subtitulo={s.hayUsd ? 'en dólares (USD)' : 'en bolívares (VES)'}
      comparacion={null}
    >
      {(s.usd < 0 || s.ves < 0) && <p className="mt-1 text-xs text-amber-800">Saldo negativo: ha salido más dinero del que se registró como entrada.</p>}
      {s.hayUsd && s.hayVes && (
        <p className="mt-1 text-sm font-medium text-text-secondary tabular-nums">Bs {formatearNumero(s.ves, 2)} <span className="text-xs font-normal text-text-muted">en bolívares (VES)</span></p>
      )}
    </TarjetaKpi>
  );
}

function DashboardKpis({ semanas, saldos, tickets, bancas, puedeFacturar }: DashboardKpisProps) {
  return (
    <GrillaKpis>
      <KpiKgSemana semanas={semanas} />
      <KpiPorPagar saldos={saldos} />
      <KpiTickets tickets={tickets} puedeFacturar={puedeFacturar} />
      <KpiCochinito bancas={bancas} />
    </GrillaKpis>
  );
}

export default DashboardKpis;
