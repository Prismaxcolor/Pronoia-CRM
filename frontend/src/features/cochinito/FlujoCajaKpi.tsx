import { useMemo } from 'react';
import { Waves } from 'lucide-react';
import { BarrasVerticales, TarjetaKpi, colorDeSerie, formatearNumero, formatearUsdDecimales } from '../../components/ui';
import { flujoCajaSemanal } from '../../lib/cochinito-kpis';
import type { Movimiento } from '@shared/types/index.js';

const ALTO_GRAFICA = 110;
const usd = (v: number) => `USD ${formatearNumero(v, 2)}`;

interface Props {
  /** Movimientos vigentes del periodo elegido. */
  movimientos: readonly Movimiento[];
}

/** Indicador de flujo de caja: neto del periodo en USD y una gráfica pequeña de ingresos y egresos por semana. */
function FlujoCajaKpi({ movimientos }: Props) {
  const flujo = useMemo(() => flujoCajaSemanal(movimientos), [movimientos]);
  const hayDatos = flujo.categorias.length > 0;
  const neto = flujo.totalIngresos - flujo.totalEgresos;
  return (
    <TarjetaKpi
      titulo="Flujo de caja"
      icono={<Waves size={16} />}
      ayuda="Dólares (USD) que entraron (ingresos) menos los que salieron (egresos) en el periodo elegido arriba; las transferencias entre bancas propias no cuentan. La gráfica compara, semana a semana (de lunes a domingo), lo que entró y lo que salió. Los movimientos sin equivalente en USD no se incluyen."
      valor={formatearUsdDecimales(neto)}
      subtitulo={`neto del periodo · entró ${formatearUsdDecimales(flujo.totalIngresos)} · salió ${formatearUsdDecimales(flujo.totalEgresos)}`}
      estado={hayDatos ? 'listo' : 'vacio'}
      mensajeVacio="No hubo ingresos ni egresos en este periodo"
    >
      <div className="mt-2">
        <BarrasVerticales
          categorias={flujo.categorias}
          series={[
            { etiqueta: 'Ingresos', valores: flujo.ingresos, color: colorDeSerie(0) },
            { etiqueta: 'Egresos', valores: flujo.egresos, color: colorDeSerie(1) },
          ]}
          alto={ALTO_GRAFICA}
          formatoValor={usd}
          etiquetaAria="Flujo de caja semanal en USD: ingresos y egresos"
        />
      </div>
    </TarjetaKpi>
  );
}

export default FlujoCajaKpi;
