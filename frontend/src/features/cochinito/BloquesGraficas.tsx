import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft } from 'lucide-react';
import { BarrasVerticales, Bloque, EstadoVacio, LineaTiempo, SkeletonGrafica, colorDeSerie, formatearFecha, formatearNumero, formatearPct } from '../../components/ui';
import { obtenerHistorialTasa } from '../../services/tasa-service';
import { puntosDeTasa, serieSemanal, type PuntoTasa } from '../../lib/cochinito-kpis';
import type { Movimiento } from '@shared/types/index.js';

/** Máximo de lecturas que pide el historial (el servidor topa en 200). */
const LECTURAS_TASA = 200;

const usd = (v: number) => `USD ${formatearNumero(v, 2)}`;
const bs = (v: number) => `Bs ${formatearNumero(v, 2)}`;

interface Props {
  /** Movimientos del periodo elegido. */
  movimientos: readonly Movimiento[];
  /** Se puede registrar un movimiento (permiso cochinito:crear). */
  puedeCrear: boolean;
  /** Hay algún ingreso en todo el historial (no solo en el periodo). */
  hayIngresosEnHistorial: boolean;
  onRegistrar: () => void;
}

function EgresosSemanales({ movimientos }: { movimientos: readonly Movimiento[] }) {
  const serie = useMemo(() => serieSemanal(movimientos, 'egreso'), [movimientos]);
  const hayOtros = serie.otros.some(v => v > 0);
  const series = [
    { etiqueta: 'Pagos', valores: serie.pagos, color: colorDeSerie(0) },
    { etiqueta: 'Adelantos', valores: serie.adelantos, color: colorDeSerie(1) },
    ...(hayOtros ? [{ etiqueta: 'Otros egresos', valores: serie.otros, color: colorDeSerie(2) }] : []),
  ];
  return (
    <Bloque
      titulo="Egresos por semana"
      queEstasViendo="Cuántos dólares (USD) salieron cada semana, separando pagos de adelantos; cada barra va de lunes a domingo y su fecha es el lunes. Respeta el periodo elegido arriba y no incluye egresos sin equivalente en USD."
    >
      <div className="rounded-xl border border-border bg-surface p-3">
        <BarrasVerticales
          categorias={serie.categorias}
          series={series}
          apilada
          formatoValor={usd}
          etiquetaAria="Egresos semanales en USD, pagos y adelantos apilados"
          mensajeVacio="No hay egresos en este periodo. Amplía el periodo o registra un movimiento para verlos aquí."
        />
      </div>
    </Bloque>
  );
}

function IngresosBloque({ movimientos, puedeCrear, hayIngresosEnHistorial, onRegistrar }: Props) {
  const ingresos = useMemo(() => serieSemanal(movimientos, 'ingreso'), [movimientos]);
  const hayIngresos = ingresos.categorias.length > 0;
  const transferencias = movimientos.filter(m => m.tipo === 'transferencia').length;
  return (
    <Bloque
      titulo="Ingresos y transferencias"
      queEstasViendo="Dinero que entró a las bancas en el periodo elegido, sumado por semana en USD. Debajo se cuenta cuántas transferencias entre bancas propias hubo; esas no se suman como ingreso ni como egreso."
    >
      {hayIngresos ? (
        <div className="rounded-xl border border-border bg-surface p-3">
          <BarrasVerticales
            categorias={ingresos.categorias}
            series={[{ etiqueta: 'Ingresos', valores: ingresos.total, color: colorDeSerie(0) }]}
            formatoValor={usd}
            etiquetaAria="Ingresos semanales en USD"
          />
          {transferencias > 0 && <p className="mt-2 text-xs text-text-secondary">Además hay {transferencias} {transferencias === 1 ? 'transferencia' : 'transferencias'} entre bancas en el periodo.</p>}
        </div>
      ) : (
        <EstadoVacio
          icono={<ArrowDownLeft size={22} />}
          mensaje={hayIngresosEnHistorial ? 'No hay ingresos en este periodo' : 'Aún no hay ingresos registrados'}
          descripcion="En este periodo solo hay egresos. Cuando registres un ingreso (por ejemplo el cobro de un cliente) aparecerá aquí, y los saldos de las bancas dejarán de depender solo de los egresos."
          accion={puedeCrear ? { etiqueta: 'Registrar un ingreso', onClick: onRegistrar, soloEnLinea: true } : undefined}
        />
      )}
    </Bloque>
  );
}

function EvolucionTasa() {
  const [puntos, setPuntos] = useState<PuntoTasa[] | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelado = false;
    obtenerHistorialTasa('bcv', LECTURAS_TASA).then(h => { if (!cancelado) setPuntos(puntosDeTasa(h)); });
    return () => { cancelado = true; };
  }, [version]);

  const reintentar = useCallback(() => { setPuntos(null); setVersion(v => v + 1); }, []);

  const resumen = useMemo(() => {
    if (!puntos || puntos.length < 2) return null;
    const primero = puntos[0];
    const ultimo = puntos[puntos.length - 1];
    const variacion = primero.valor === 0 ? null : ((ultimo.valor - primero.valor) / primero.valor) * 100;
    return { primero, ultimo, variacion };
  }, [puntos]);

  return (
    <Bloque
      titulo="Evolución de la tasa BCV"
      queEstasViendo={`Cuántos bolívares (Bs) costó 1 USD según la tasa oficial del Banco Central de Venezuela (BCV). Se muestra una lectura por día (la última de ese día), tomando como máximo las últimas ${LECTURAS_TASA} lecturas guardadas.`}
    >
      {puntos === null ? (
        <SkeletonGrafica />
      ) : puntos.length < 2 ? (
        <EstadoVacio
          mensaje="Aún no hay suficientes lecturas de la tasa para dibujar la evolución"
          descripcion="Se necesitan al menos dos días con tasa guardada, o el servicio de tasas no respondió."
          accion={{ etiqueta: 'Reintentar', onClick: reintentar }}
        />
      ) : (
        <div className="rounded-xl border border-border bg-surface p-3">
          <LineaTiempo
            puntos={puntos.map(p => ({ etiqueta: p.etiqueta, valor: p.valor }))}
            formatoValor={bs}
            etiquetaAria="Evolución diaria de la tasa BCV en bolívares por dólar"
          />
          {resumen && (
            <p className="mt-2 text-xs text-text-secondary">
              De {bs(resumen.primero.valor)} ({formatearFecha(resumen.primero.dia)}) a {bs(resumen.ultimo.valor)} ({formatearFecha(resumen.ultimo.dia)})
              {resumen.variacion !== null && <> · {resumen.variacion >= 0 ? 'subió' : 'bajó'} {formatearPct(Math.abs(resumen.variacion), 1)}</>}
              {' '}· {puntos.length} lecturas
            </p>
          )}
        </div>
      )}
    </Bloque>
  );
}

/** Gráficas pesadas de /cochinito (se cargan con React.lazy después de los indicadores). */
function BloquesGraficas(props: Props) {
  return (
    <>
      <EgresosSemanales movimientos={props.movimientos} />
      <IngresosBloque {...props} />
      <EvolucionTasa />
    </>
  );
}

export default BloquesGraficas;
