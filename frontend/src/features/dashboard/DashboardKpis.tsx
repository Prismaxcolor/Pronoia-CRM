import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Landmark, PiggyBank, RefreshCw, Scale, Ticket } from 'lucide-react';
import type { RespuestaSaldos } from '@shared/types/saldos.js';
import { GrillaKpis, TarjetaKpi, formatearFecha, formatearKg, formatearNumero, formatearPct, formatearUsd } from '../../components/ui';
import { compararKg, formatoDeltaConPct, contarCompras, periodoAnteriorComparable, sumarKg, type BancaMinima, type ResumenTickets, saldosPorMoneda } from '../../lib/dashboard-kpis';
import type { EstadoBloque } from './useDashboardCarga';
import type { SemanasKg } from './dashboardFuentes';

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
  const ayuda = 'Suma de los kilos de las compras confirmadas (se excluyen borradores y anuladas) de los últimos 7 días, incluido hoy. Se compara con los 7 días anteriores; si ese periodo no tiene datos fiables se dice "sin historial comparable" en vez de inventar un porcentaje.';
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
      {!cmp && <p className="mt-2 text-xs text-text-muted">Sin historial comparable: la semana anterior no tiene compras registradas completas.</p>}
    </TarjetaKpi>
  );
}

function KpiPorPagar({ saldos }: { saldos: Estado<RespuestaSaldos> }) {
  const titulo = 'Por pagar a proveedores';
  const icono = <Landmark size={16} />;
  const ayuda = 'Suma de lo que se les debe a los proveedores con saldo positivo: facturas y notas de débito vigentes, menos pagos, adelantos y notas de crédito. Es la misma cifra del estado de cuenta de cada proveedor. Es una foto que se recalcula cada ~20 segundos.';
  const pendiente = tarjetaNoLista(saldos, titulo, icono, ayuda, { dinero: true, mensaje: '' });
  if (pendiente || saldos.estado !== 'listo') return pendiente;

  const { totales, saldos: lista, calculadoEn } = saldos.dato;
  const conDeuda = lista.filter(s => s.saldo > 0).length;
  const hora = new Date(calculadoEn).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
  return (
    <TarjetaKpi titulo={titulo} icono={icono} ayuda={ayuda} valor={formatearUsd(totales.porPagar ?? 0)} subtitulo={`${conDeuda} ${conDeuda === 1 ? 'proveedor con saldo' : 'proveedores con saldo'} · calculado ${hora}`} comparacion={null}>
      {totales.aFavor > 0 && <p className="mt-1 text-xs text-text-muted">Aparte, {formatearUsd(totales.aFavor)} a favor (pagado de más), que no se resta de esta cifra.</p>}
      <p className="mt-1 text-xs"><Link to="/proveedores" className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Ver proveedores →</Link></p>
    </TarjetaKpi>
  );
}

function KpiTickets({ tickets, puedeFacturar }: { tickets: Estado<ResumenTickets>; puedeFacturar: boolean }) {
  const titulo = 'Tickets pendientes';
  const icono = <Ticket size={16} />;
  const ayuda = 'Por recepcionar: compras pesadas "en bruto" que aún no se completaron (no mueven inventario ni se pueden facturar). Sin facturar: compras ya completas que todavía no tienen factura.';
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
      subtitulo="compras en bruto, sin completar"
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
  const titulo = 'Saldo del cochinito';
  const icono = <PiggyBank size={16} />;
  const ayuda = 'Suma del saldo de las bancas activas del cochinito, separada por moneda: el dólar y el bolívar nunca se suman entre sí.';
  const pendiente = tarjetaNoLista(bancas, titulo, icono, ayuda, { dinero: true, mensaje: '' });
  if (pendiente || bancas.estado !== 'listo') return pendiente;

  const s = saldosPorMoneda(bancas.dato);
  if (!s.hayUsd && !s.hayVes) {
    return <TarjetaKpi titulo={titulo} icono={icono} ayuda={ayuda} estado="vacio" mensajeVacio="No hay bancas activas en el cochinito" />;
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
      {(s.usd < 0 || s.ves < 0) && <p className="mt-1 text-xs text-amber-800">Saldo negativo: los egresos registrados superan lo ingresado en el cochinito.</p>}
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
