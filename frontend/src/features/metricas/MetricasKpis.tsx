import { DollarSign, Scale, Truck, TrendingUp } from 'lucide-react';
import { GrillaKpis, TarjetaKpi, formatearFecha, formatearKg, formatearNumero, formatearPct, formatearUsdDecimales } from '../../components/ui';
import type { ComparacionPeriodo } from '../../lib/comparacion';
import { FECHA_INICIO_DATOS_REALES, formatoDeltaConPct } from '../../lib/dashboard-kpis';
import { compararMetrica, type ResumenCompras } from '../../lib/metricas-kpis';

export interface MetricasKpisProps {
  resumen: ResumenCompras;
  anterior: ResumenCompras;
  /** El periodo anterior tiene datos fiables para comparar. */
  comparable: boolean;
  puedeVerCostos: boolean;
  desde: string;
  hasta: string;
  dias: number;
}

const conPorcentaje = (cmp: ComparacionPeriodo | null, formato: (d: number) => string) => formatoDeltaConPct(cmp, formato, p => formatearPct(p, 1));

function SinHistorial() {
  return <p className="mt-2 text-xs text-text-muted">Sin historial comparable: el periodo anterior no tiene compras o empieza antes del {formatearFecha(FECHA_INICIO_DATOS_REALES)}, cuando comenzó el registro real.</p>;
}

function MetricasKpis({ resumen, anterior, comparable, puedeVerCostos, desde, hasta, dias }: MetricasKpisProps) {
  const cKg = compararMetrica(resumen.kgTotal, anterior.kgTotal, comparable, null);
  const cCosto = compararMetrica(resumen.costoTotal, anterior.costoTotal, comparable, null);
  const cPromedio = compararMetrica(resumen.costoPromedioKg, anterior.costoPromedioKg, comparable, 'baja');
  const cProv = compararMetrica(resumen.proveedoresCount, anterior.proveedoresCount, comparable, null);
  const origen = `${formatearFecha(desde)} al ${formatearFecha(hasta)} (${dias} ${dias === 1 ? 'día' : 'días'})`;

  return (
    <GrillaKpis>
      <TarjetaKpi
        titulo="Kilos comprados"
        icono={<Scale size={16} />}
        ayuda="Kilos (kg) de todas las compras confirmadas del periodo: se suma el peso de cada línea de cada factura de compra. No cuentan las compras en borrador ni las anuladas, y cada compra cae en la fecha de su factura. Se compara con el periodo anterior de la misma duración."
        valor={formatearNumero(resumen.kgTotal, 0)}
        unidad="kg"
        subtitulo={`${formatearNumero(resumen.kgTotal / 1000, 1)} t · ${origen}`}
        comparacion={cKg ?? undefined}
        formatoDelta={conPorcentaje(cKg, formatearKg)}
      >
        {!cKg && <SinHistorial />}
      </TarjetaKpi>

      <TarjetaKpi
        titulo="Costo total"
        icono={<DollarSign size={16} />}
        ayuda="Valor en USD de las compras confirmadas del periodo: se suma el subtotal de cada línea de compra (peso por precio). Solo lo ven quienes tienen permiso de facturación."
        estado={puedeVerCostos ? 'listo' : 'sinPermiso'}
        valor={formatearUsdDecimales(resumen.costoTotal)}
        subtitulo={`${resumen.comprasCount} ${resumen.comprasCount === 1 ? 'compra' : 'compras'} confirmadas`}
        comparacion={cCosto ?? undefined}
        formatoDelta={conPorcentaje(cCosto, d => formatearUsdDecimales(d))}
      >
        {!cCosto && <SinHistorial />}
      </TarjetaKpi>

      <TarjetaKpi
        titulo="Costo promedio por kg"
        icono={<TrendingUp size={16} />}
        ayuda="USD que costó cada kilo en promedio: costo total dividido entre los kilos comprados. Pesa más lo que más se compró. Por ejemplo: 1.000 USD por 2.000 kg dan 0,50 USD/kg. Que baje es favorable. Solo lo ven quienes tienen permiso de facturación."
        estado={puedeVerCostos ? 'listo' : 'sinPermiso'}
        valor={formatearUsdDecimales(resumen.costoPromedioKg)}
        unidad="/kg"
        subtitulo="costo total ÷ kilos comprados (USD por kg)"
        comparacion={cPromedio ?? undefined}
        formatoDelta={conPorcentaje(cPromedio, d => `${formatearUsdDecimales(d)}/kg`)}
      >
        {!cPromedio && <SinHistorial />}
      </TarjetaKpi>

      <TarjetaKpi
        titulo="Proveedores"
        icono={<Truck size={16} />}
        ayuda="Cuántos proveedores distintos tuvieron al menos una compra confirmada en el periodo. Debajo, cuántos materiales distintos se compraron."
        valor={formatearNumero(resumen.proveedoresCount, 0)}
        unidad={resumen.proveedoresCount === 1 ? 'proveedor' : 'proveedores'}
        subtitulo={`${resumen.materialesCount} ${resumen.materialesCount === 1 ? 'material distinto' : 'materiales distintos'}`}
        comparacion={cProv ?? undefined}
        formatoDelta={d => formatearNumero(d, 0)}
      >
        {!cProv && <SinHistorial />}
      </TarjetaKpi>
    </GrillaKpis>
  );
}

export default MetricasKpis;
