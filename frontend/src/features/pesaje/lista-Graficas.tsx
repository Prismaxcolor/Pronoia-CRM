import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Bloque, BarraProgreso, EstadoVacio, formatearFechaCorta, formatearKg, formatearNumero } from '../../components/ui';
import BarrasVerticales from '../../components/ui/graficas/BarrasVerticales';
import type { TicketPesaje } from '@shared/types/index.js';
import { avanceRecepcionCompras, kgPorDia } from '../../lib/pesaje-kpis';

const DIAS_GRAFICA = 14;
/** Con menos días con pesajes que esto no hay tendencia que mostrar: se explica en vez de dibujar una barra suelta. */
const MIN_DIAS_CON_DATOS = 2;

interface Props {
  tickets: readonly TicketPesaje[];
  hoyIso: string;
  /** Lleva a la pestaña "Nuevo pesaje" (estado vacío). */
  onRegistrarPesaje: () => void;
}

/** Barras apiladas de kg por día (compra y venta, últimos 14 días) y avance de compras recepcionadas. Se carga aparte (lazy). */
function ListaGraficas({ tickets, hoyIso, onRegistrarPesaje }: Props) {
  const porDia = useMemo(() => kgPorDia(tickets, hoyIso, DIAS_GRAFICA), [tickets, hoyIso]);
  const avance = useMemo(() => avanceRecepcionCompras(tickets), [tickets]);
  const suficiente = porDia.diasConDatos >= MIN_DIAS_CON_DATOS;
  const faltan = avance.total - avance.completas;

  return (
    <div className="grid grid-cols-1 gap-x-6 lg:grid-cols-3 print:hidden">
      <div className="lg:col-span-2">
        <Bloque
          titulo="Kg pesados por día"
          queEstasViendo={`los kg pesados cada día en los últimos ${DIAS_GRAFICA} días, hasta hoy. Cada barra es un día y el color separa compras de ventas. De cada ticket se cuenta el peso neto de sus materiales (o el peso global si sigue por recepcionar) en la fecha del ticket; los traslados no se incluyen.`}
        >
          <div className="relative overflow-hidden rounded-xl border border-border bg-surface p-3 sm:p-4">
            {suficiente ? (
              <BarrasVerticales
                apilada
                categorias={porDia.fechas.map(formatearFechaCorta)}
                series={[
                  { etiqueta: 'Compra', valores: porDia.compra },
                  { etiqueta: 'Venta', valores: porDia.venta },
                ]}
                formatoValor={formatearKg}
                etiquetaAria={`Kg pesados por día en los últimos ${DIAS_GRAFICA} días, compra y venta apiladas`}
              />
            ) : (
              <EstadoVacio
                mensaje="Aún no hay suficientes días con pesajes para dibujar la gráfica."
                descripcion={`Hace falta pesar en al menos ${MIN_DIAS_CON_DATOS} días distintos de los últimos ${DIAS_GRAFICA}.`}
                accion={{ etiqueta: 'Registra un pesaje', onClick: onRegistrarPesaje }}
              />
            )}
          </div>
        </Bloque>
      </div>

      <Bloque
        titulo="Compras recepcionadas"
        queEstasViendo="qué parte de las compras registradas ya está completa, es decir, con sus materiales anotados, frente al total de compras. Por ejemplo: 8 de 10 compras completas es 80 %. Las que faltan son tickets por recepcionar."
      >
        <div className="rounded-xl border border-border bg-surface p-4">
          {avance.porcentaje === null ? (
            <EstadoVacio mensaje="Aún no hay compras registradas." accion={{ etiqueta: 'Registra la primera compra', onClick: onRegistrarPesaje }} />
          ) : (
            <>
              <p className="text-2xl font-bold tabular-nums text-text-primary">
                {formatearNumero(avance.porcentaje, 0)} %
                <span className="ml-2 text-sm font-medium text-text-secondary">recepcionado</span>
              </p>
              <div className="my-3">
                <BarraProgreso valor={avance.completas} max={avance.total} etiqueta="Compras recepcionadas sobre el total de compras" />
              </div>
              <p className="text-sm text-text-primary">
                {formatearNumero(avance.completas, 0)} de {formatearNumero(avance.total, 0)} compras completas
              </p>
              {faltan > 0 ? (
                <p className="mt-1 text-xs text-text-secondary">
                  {faltan === 1 ? 'Falta 1 por completar' : `Faltan ${faltan} por completar`}.{' '}
                  <Link to="?estado=bruto" className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Ver por recepcionar →</Link>
                </p>
              ) : (
                <p className="mt-1 text-xs text-text-secondary">No queda ninguna compra por completar.</p>
              )}
            </>
          )}
        </div>
      </Bloque>
    </div>
  );
}

export default ListaGraficas;
