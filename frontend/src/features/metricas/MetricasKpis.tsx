import { DollarSign, Scale, Truck, TrendingUp } from 'lucide-react';
import { GrillaKpis, TarjetaKpi, formatearFecha, formatearKg, formatearNumero, formatearPct, formatearUsdDecimales } from '../../components/ui';
import type { ComparacionPeriodo } from '../../lib/comparacion';
import { formatoDeltaConPct } from '../../lib/dashboard-kpis';
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
  return <p className="mt-2 text-xs text-text-muted">Sin historial comparable en el periodo anterior.</p>;
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
        ayuda="Suma de los kilos de todas las líneas de compras confirmadas del periodo (se excluyen borradores y anuladas). Se compara con el periodo anterior de la misma duración."
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
        ayuda="Suma del subtotal de las líneas de compra del periodo, en USD. Solo lo ven quienes tienen permiso de facturación."
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
        ayuda="Costo total entre kilos comprados (promedio ponderado: pesa más lo que más se compró). Bajar es favorable. Solo lo ven quienes tienen permiso de facturación."
        estado={puedeVerCostos ? 'listo' : 'sinPermiso'}
        valor={formatearUsdDecimales(resumen.costoPromedioKg)}
        unidad="/kg"
        subtitulo="costo total ÷ kilos comprados"
        comparacion={cPromedio ?? undefined}
        formatoDelta={conPorcentaje(cPromedio, d => `${formatearUsdDecimales(d)}/kg`)}
      >
        {!cPromedio && <SinHistorial />}
      </TarjetaKpi>

      <TarjetaKpi
        titulo="Proveedores"
        icono={<Truck size={16} />}
        ayuda="Cantidad de proveedores distintos a los que se les compró en el periodo."
        valor={formatearNumero(resumen.proveedoresCount, 0)}
        unidad={resumen.proveedoresCount === 1 ? 'proveedor' : 'proveedores'}
        subtitulo={`${resumen.materialesCount} ${resumen.materialesCount === 1 ? 'material' : 'materiales'}`}
        comparacion={cProv ?? undefined}
        formatoDelta={d => formatearNumero(d, 0)}
      >
        {!cProv && <SinHistorial />}
      </TarjetaKpi>
    </GrillaKpis>
  );
}

export default MetricasKpis;
