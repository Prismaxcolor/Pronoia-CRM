import { useMemo } from 'react';
import { ArrowUpRight, Coins, Landmark, Scale } from 'lucide-react';
import { BarraApilada, GrillaKpis, TarjetaKpi, colorDeSerie, formatearFecha, formatearNumero, formatearUsdDecimales } from '../../components/ui';
import { compararConPeriodoAnterior } from '../../lib/comparacion';
import type { KpisCochinito } from '../../lib/cochinito-kpis';

interface Props {
  kpis: KpisCochinito;
  periodo: { desde: string; hasta: string };
}

const SIN_COMPARABLE = 'Sin historial comparable: el periodo anterior empieza antes del primer movimiento registrado, así que estaría incompleto y la comparación engañaría.';

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
        ayuda="Dólares (USD) que hay hoy en las bancas activas en USD (las archivadas no cuentan); no depende del periodo elegido. El saldo de cada banca es lo que entró (ingresos y transferencias recibidas) menos lo que salió (egresos y transferencias enviadas). Sale negativo cuando ha salido más dinero del que se registró como entrada."
        valor={formatearUsdDecimales(kpis.saldoUsd)}
        subtitulo={`${kpis.bancasUsd} ${kpis.bancasUsd === 1 ? 'banca activa' : 'bancas activas'} en USD`}
        tonoValor="normal"
      >
        {kpis.saldoUsd < 0 && <p className="mt-2 text-xs text-amber-800">En negativo: ha salido más dinero del que se registró como entrada. Revisa si falta registrar algún ingreso.</p>}
      </TarjetaKpi>

      <TarjetaKpi
        titulo="Saldo en bolívares"
        icono={<Landmark size={16} />}
        ayuda="Bolívares (Bs) que hay hoy en las bancas activas en VES (las archivadas no cuentan); no depende del periodo elegido. Es la suma de sus saldos actuales y no se convierte a dólares."
        valor={`Bs ${formatearNumero(kpis.saldoVes, 2)}`}
        subtitulo={`${kpis.bancasVes} ${kpis.bancasVes === 1 ? 'banca activa' : 'bancas activas'} en VES`}
      />

      <TarjetaKpi
        titulo="Egresos del periodo"
        icono={<ArrowUpRight size={16} />}
        ayuda="Dólares (USD) que salieron en el periodo elegido arriba: suma de todos los egresos (pagos, adelantos y otros) según su fecha. Las transferencias entre bancas no cuentan, y un egreso sin equivalente en USD se avisa aparte y no se suma. Se compara con el periodo justo anterior de igual duración (por ejemplo, 30 días contra los 30 días de antes); si ese periodo empieza antes del primer movimiento registrado, dice «sin historial comparable»."
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
        ayuda="De los egresos del periodo, cuántos USD fueron adelantos (dinero entregado antes de tener la factura) y cuántos fueron pagos de facturas. El número grande es el total de adelantos; debajo van los pagos, y la barra muestra qué parte es cada uno. Otros egresos sin tipo no entran aquí."
        valor={`${formatearUsdDecimales(kpis.periodo.adelantosUsd)}`}
        subtitulo={`adelantos del periodo (${kpis.periodo.cantidadAdelantos}) · pagos de facturas: ${formatearUsdDecimales(kpis.periodo.pagosUsd)} (${kpis.periodo.cantidadPagos})`}
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
