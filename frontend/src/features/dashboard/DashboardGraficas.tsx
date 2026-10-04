import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Bloque, BarrasHorizontales, EstadoVacio, LineaTiempo, SkeletonBloque, formatearFechaCorta, formatearKg, formatearNumero, formatearUsd } from '../../components/ui';
import { bancasConSaldo, bancasNegativas, hayDatosParaTendencia, kgPorDia, sumarDiasIso, type BancaMinima } from '../../lib/dashboard-kpis';
import { colorDeSerie } from '../../lib/paleta';
import { ErrorDeBloque } from './DashboardComun';
import type { EstadoBloque } from './useDashboardCarga';
import type { SemanasKg } from './dashboardFuentes';

/** Gráficas del Dashboard. Se cargan con React.lazy (después de los indicadores): este módulo no debe importarse de forma estática. */

const DIAS_TENDENCIA = 14;

const dinero = (moneda: 'USD' | 'VES') => (v: number): string => (moneda === 'USD' ? formatearUsd(v) : `Bs ${formatearNumero(v, 2)}`);

export function TendenciaKg({ semanas }: { semanas: EstadoBloque<SemanasKg> & { recargar: () => void } }) {
  const serie = useMemo(() => {
    if (semanas.estado !== 'listo') return [];
    const { rangos, actual, anterior } = semanas.dato;
    return kgPorDia([...anterior, ...actual], sumarDiasIso(rangos.actual.hasta, -(DIAS_TENDENCIA - 1)), rangos.actual.hasta);
  }, [semanas]);

  return (
    <Bloque titulo="Kilos comprados por día" queEstasViendo="los kilos (kg) de compras confirmadas en cada uno de los últimos 14 días; un día sin compras vale 0. Pasa el cursor o usa las flechas para ver cada día.">
      {semanas.estado === 'cargando' && <SkeletonBloque alto="h-56" etiqueta="Cargando tendencia" />}
      {semanas.estado === 'sinPermiso' && <EstadoVacio mensaje="Sin permiso para ver las compras" />}
      {semanas.estado === 'error' && <ErrorDeBloque mensaje={semanas.mensaje} onReintentar={semanas.recargar} />}
      {semanas.estado === 'listo' && (hayDatosParaTendencia(serie)
        ? (
          <div className="rounded-xl border border-border bg-surface p-4">
            <LineaTiempo
              puntos={serie.map(p => ({ etiqueta: formatearFechaCorta(p.fecha), valor: p.kg }))}
              formatoValor={formatearKg}
              etiquetaAria="Kilos comprados por día, últimos 14 días"
              alto={220}
            />
          </div>
        )
        : (
          <EstadoVacio
            mensaje="Todavía hay pocos días con compras para dibujar una tendencia"
            descripcion="Se grafica cuando hay compras confirmadas en al menos 3 de los últimos 14 días. Cada compra que se pesa y se factura alimenta esta gráfica."
            accion={{ etiqueta: 'Registrar un pesaje', to: '/pesaje' }}
          />
        ))}
    </Bloque>
  );
}

export function SaldoBancas({ bancas }: { bancas: EstadoBloque<BancaMinima[]> & { recargar: () => void } }) {
  const grupos = useMemo(() => {
    if (bancas.estado !== 'listo') return [];
    return (['USD', 'VES'] as const)
      .map(moneda => ({ moneda, items: bancasConSaldo(bancas.dato, moneda), negativas: bancasNegativas(bancas.dato, moneda) }))
      .filter(g => g.items.length > 0 || g.negativas.length > 0);
  }, [bancas]);

  return (
    <Bloque titulo="Saldo por banca" queEstasViendo="cuánto dinero tiene hoy cada banca del cochinito (su saldo actual). Las de dólares (USD) y las de bolívares (VES) van en gráficas separadas porque sus montos no se pueden comparar entre sí.">
      {bancas.estado === 'cargando' && <SkeletonBloque alto="h-56" etiqueta="Cargando bancas" />}
      {bancas.estado === 'sinPermiso' && <EstadoVacio mensaje="Sin permiso para ver el cochinito" />}
      {bancas.estado === 'error' && <ErrorDeBloque mensaje={bancas.mensaje} onReintentar={bancas.recargar} />}
      {bancas.estado === 'listo' && (grupos.length === 0
        ? <EstadoVacio mensaje="Ninguna banca tiene saldo todavía" descripcion="Las bancas aparecen aquí cuando tienen saldo distinto de cero." accion={{ etiqueta: 'Ir al cochinito', to: '/cochinito' }} />
        : (
          <div className="space-y-5 rounded-xl border border-border bg-surface p-4">
            {grupos.map(g => (
              <div key={g.moneda}>
                <h3 className="mb-2 text-sm font-medium text-text-secondary">{g.moneda === 'USD' ? 'Bancas en dólares (USD)' : 'Bancas en bolívares (VES)'}</h3>
                {g.items.length > 0 && (
                  <BarrasHorizontales
                    datos={g.items.map((b, i) => ({ etiqueta: b.nombre, valor: b.saldo, detalle: b.descripcion || undefined, color: colorDeSerie(i), to: '/cochinito' }))}
                    formatoValor={dinero(g.moneda)}
                    etiquetaAria={`Saldo por banca en ${g.moneda}`}
                  />
                )}
                {g.negativas.length > 0 && (
                  <div role="note" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                    <p className="font-medium">Saldo negativo (no se puede dibujar como barra)</p>
                    <p className="mt-0.5">En estas bancas ha salido más dinero del que se registró como entrada.</p>
                    <ul className="mt-1 space-y-0.5">
                      {g.negativas.map(b => <li key={b.id} className="flex justify-between gap-3"><span>{b.nombre}</span><span className="font-medium tabular-nums">-{dinero(g.moneda)(Math.abs(b.saldo))}</span></li>)}
                    </ul>
                  </div>
                )}
              </div>
            ))}
            <p className="text-xs text-text-secondary"><Link to="/cochinito" className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Ver el cochinito →</Link></p>
          </div>
        ))}
    </Bloque>
  );
}
