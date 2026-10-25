import { useMemo } from 'react';
import { ArrowDownLeft } from 'lucide-react';
import { BarrasVerticales, Bloque, EstadoVacio, colorDeSerie, formatearNumero } from '../../components/ui';
import { serieSemanal } from '../../lib/cochinito-kpis';
import type { Movimiento } from '@shared/types/index.js';

const usd = (v: number) => `USD ${formatearNumero(v, 2)}`;

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
  return (
    <Bloque
      titulo="Ingresos por semana"
      queEstasViendo="Cuántos dólares (USD) entraron a las bancas cada semana; cada barra va de lunes a domingo y su fecha es el lunes. Respeta el periodo elegido arriba; las transferencias entre bancas propias no cuentan como ingreso."
    >
      {hayIngresos ? (
        <div className="rounded-xl border border-border bg-surface p-3">
          <BarrasVerticales
            categorias={ingresos.categorias}
            series={[{ etiqueta: 'Ingresos', valores: ingresos.total, color: colorDeSerie(0) }]}
            formatoValor={usd}
            etiquetaAria="Ingresos semanales en USD"
          />
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

/** Gráficas de egresos e ingresos por semana de /cochinito (React.lazy; van al final de la pantalla, bajo los movimientos). */
function BloquesGraficas(props: Props) {
  return (
    <>
      <EgresosSemanales movimientos={props.movimientos} />
      <IngresosBloque {...props} />
    </>
  );
}

export default BloquesGraficas;
