import { useMemo } from 'react';
import { ArrowUpRight, Coins, Landmark, Scale } from 'lucide-react';
import { BarraApilada, GrillaKpis, TarjetaKpi, colorDeSerie, formatearFecha, formatearNumero, formatearUsdDecimales } from '../../components/ui';
import { compararConPeriodoAnterior } from '../../lib/comparacion';
import type { KpisCochinito } from '../../lib/cochinito-kpis';

interface Props {
  kpis: KpisCochinito;
  periodo: { desde: string; hasta: string };
}

const SIN_COMPARABLE = 'Sin historial comparable: el periodo anterior es previo al primer movimiento registrado.';

/** Cuatro indicadores de /cochinito: saldos (USD y VES) y, del periodo elegido, egresos y adelantos frente a pagos. */
function KpisCochinitoGrilla({ kpis, periodo }: Props) {
  const cmpEgresos = useMemo(() => {
    if (!kpis.anterior) return undefined;
    const c = compararConPeriodoAnterior(kpis.periodo.totalUsd, kpis.anterior.totalUsd, 'baja');
    // Gastar más o menos no es "bueno" ni "malo" por sí solo: se muestra sin juicio.
    return c ? { ...c, tono: 'neutro' as const } : null;
  }, [kpis]);

  const textoPeriodo = `Del ${formatearFecha(periodo.desde)} al ${formatearFecha(periodo.hasta)}`;
  const totalEgresosPeriodo = kpis.periodo.pagosUsd + kpis.periodo.adelantosUsd;

  return (
    <GrillaKpis>
      <TarjetaKpi
        titulo="Saldo total en USD"
        icono={<Coins size={16} />}
        ayuda="Suma del saldo actual de las bancas activas cuya moneda es USD. Un saldo negativo significa que se han registrado más egresos que ingresos en esas bancas."
        valor={formatearUsdDecimales(kpis.saldoUsd)}
        subtitulo={`${kpis.bancasUsd} ${kpis.bancasUsd === 1 ? 'banca activa' : 'bancas activas'} en USD`}
        tonoValor="normal"
      >
        {kpis.saldoUsd < 0 && <p className="mt-2 text-xs text-amber-800">En negativo: aún no hay ingresos que cubran los egresos.</p>}
      </TarjetaKpi>

      <TarjetaKpi
        titulo="Saldo en bolívares"
        icono={<Landmark size={16} />}
        ayuda="Suma del saldo actual de las bancas activas cuya moneda es VES (bolívares). No se convierte a USD."
        valor={`Bs ${formatearNumero(kpis.saldoVes, 2)}`}
        subtitulo={`${kpis.bancasVes} ${kpis.bancasVes === 1 ? 'banca activa' : 'bancas activas'} en VES`}
      />

      <TarjetaKpi
        titulo="Egresos del periodo"
        icono={<ArrowUpRight size={16} />}
        ayuda="Suma en USD de los egresos (pagos y adelantos) con fecha dentro del periodo elegido arriba. Se compara con el periodo anterior de igual duración solo si ya había movimientos registrados entonces."
        valor={formatearUsdDecimales(kpis.periodo.totalUsd)}
        subtitulo={`${textoPeriodo} · ${kpis.periodo.cantidad} ${kpis.periodo.cantidad === 1 ? 'egreso' : 'egresos'}`}
        comparacion={cmpEgresos}
        formatoDelta={d => formatearUsdDecimales(d)}
      >
        {!kpis.anterior && <p className="mt-2 text-xs text-text-muted" title={SIN_COMPARABLE}>Sin historial comparable</p>}
        {kpis.periodo.sinEquivalente > 0 && <p className="mt-1 text-xs text-amber-800">{kpis.periodo.sinEquivalente} sin equivalente en USD (no sumados)</p>}
      </TarjetaKpi>

      <TarjetaKpi
        titulo="Adelantos frente a pagos"
        icono={<Scale size={16} />}
        ayuda="Del total de egresos a proveedores del periodo, cuánto fue adelanto (pago anticipado) y cuánto pago de facturas. Ambos en USD."
        valor={`${formatearUsdDecimales(kpis.periodo.adelantosUsd)}`}
        subtitulo={`en ${kpis.periodo.cantidadAdelantos} ${kpis.periodo.cantidadAdelantos === 1 ? 'adelanto' : 'adelantos'} · pagos: ${formatearUsdDecimales(kpis.periodo.pagosUsd)} (${kpis.periodo.cantidadPagos})`}
        estado={totalEgresosPeriodo > 0 ? 'listo' : 'vacio'}
        mensajeVacio="No hubo pagos ni adelantos en este periodo"
      >
        <div className="mt-2">
          <BarraApilada
            rotulo="Egresos del periodo"
            leyenda="fila"
            formatoValor={formatearUsdDecimales}
            segmentos={[
              { clave: 'pagos', etiqueta: 'Pagos', valor: kpis.periodo.pagosUsd, color: colorDeSerie(0) },
              { clave: 'adelantos', etiqueta: 'Adelantos', valor: kpis.periodo.adelantosUsd, color: colorDeSerie(1) },
            ]}
          />
        </div>
      </TarjetaKpi>
    </GrillaKpis>
  );
}

export default KpisCochinitoGrilla;
