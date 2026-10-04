import { Coins, PackageCheck, Percent, Warehouse } from 'lucide-react';
import {
  compararConPeriodoAnterior,
  derivarKpis,
  formatearKg,
  formatearNumero,
  formatearPct,
  formatearUsd,
} from '../../../lib/inventario-nuevo';
import { ETIQUETAS_MERMA, type TipoMerma } from '../../../lib/merma-tipificada';
import type { ResumenInventario } from '../../../services/inventario-resumen-service';
import { GrillaKpis, SkeletonKpis, TarjetaKpi } from '../../../components/ui';

/** Esqueleto de los 4 KPIs mientras carga el resumen. */
export const KpisSkeleton = SkeletonKpis;

function KpisInventario({ resumen }: { resumen: ResumenInventario }) {
  const k = derivarKpis(resumen);
  const mermaCmp = compararConPeriodoAnterior(k.merma.pct, k.merma.pctAnterior, 'baja');
  const tiposMerma = k.merma.porTipo.filter(t => t.kg > 0);

  return (
    <GrillaKpis>
      <TarjetaKpi
        titulo="Valor del inventario (a costo)"
        icono={<Coins size={16} />}
        ayuda="Lo que costó comprar los materiales que hay hoy en stock, en USD (promedio ponderado de compra). Solo cuenta los kilos con costo registrado. El valor estimado de venta de los lotes es otra cifra y nunca se suma a esta."
        estado={k.valor.oculto ? 'sinPermiso' : 'listo'}
        valor={formatearUsd(k.valor.costoUsd ?? 0)}
        subtitulo="a costo de compra · materiales"
        comparacion={null}
      >
        <p className="mt-1 text-xs text-text-muted">
          Solo {formatearKg(k.valor.kgConCosto)} tienen costo registrado
          {k.valor.kgSinCosto > 0 && <> ({formatearKg(k.valor.kgSinCosto)} sin costo)</>}
        </p>
        <div className="mt-2 border-t border-dashed border-border pt-2">
          <p className="text-xs text-text-muted">Valor estimado de venta de lotes (otra cifra, no se suma)</p>
          <p className="text-sm font-medium text-text-secondary tabular-nums">
            {(k.valor.ventaEstimadaUsd ?? 0) === 0 && k.valor.kgSinPrecio > 0
              ? <span className="font-normal text-text-muted">Sin precios cargados · {formatearKg(k.valor.kgSinPrecio)} de lotes</span>
              : <>
                {formatearUsd(k.valor.ventaEstimadaUsd ?? 0)}
                {k.valor.kgSinPrecio > 0 && <span className="font-normal text-text-muted"> · {formatearKg(k.valor.kgSinPrecio)} de lotes sin precio</span>}
              </>}
          </p>
        </div>
      </TarjetaKpi>

      <TarjetaKpi
        titulo="Kg en galpón"
        icono={<Warehouse size={16} />}
        ayuda="Todos los kilos que hay ahora en los almacenes: materiales sueltos más lotes. Debajo se ve cuántos hay en cada galpón."
        valor={formatearKg(k.galpon.totalKg)}
        comparacion={null}
      >
        {k.galpon.almacenes.length > 0 ? (
          <ul className="mt-1 text-xs text-text-secondary">
            {k.galpon.almacenes.map(a => (
              <li key={a.nombre} className="flex justify-between gap-2"><span>{a.nombre}</span><span className="tabular-nums">{formatearKg(a.totalKg)}</span></li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-text-muted">Sin almacenes con stock</p>
        )}
      </TarjetaKpi>

      <TarjetaKpi
        titulo="Kg listos para vender / exportar"
        icono={<PackageCheck size={16} />}
        ayuda="Kilos de lotes de exportación que una persona marcó como embalados (siguen vigentes). Lo que está en saca sin embalar no cuenta como listo."
        valor={formatearKg(k.listos.kg)}
        subtitulo="embalados en lotes de exportación"
        comparacion={null}
      >
        <p className="mt-1 text-xs text-text-muted">{formatearKg(resumen.exportacion.enSacaKg)} más en saca, sin embalar</p>
      </TarjetaKpi>

      <TarjetaKpi
        titulo="Merma del periodo"
        icono={<Percent size={16} />}
        ayuda={
          <>
            Kilos perdidos en las transformaciones (basura, plástico, tierra, hierro u otro no vendible) sobre los kilos que entraron.
            Se marca como alta desde {formatearPct(k.merma.umbralPct, 0)}. Lo que no se tipificó aparece como «sin clasificar».
          </>
        }
        estado={k.merma.transformaciones === 0 ? 'vacio' : 'listo'}
        mensajeVacio="Sin transformaciones en este periodo"
        valor={formatearPct(k.merma.pct)}
        tonoValor={k.merma.sobreUmbral ? 'peligro' : 'normal'}
        subtitulo={
          <>
            {formatearKg(k.merma.kgMerma)} de merma · umbral {formatearPct(k.merma.umbralPct, 0)}
            {k.merma.sobreUmbral && <span className="font-medium text-red-700"> · por encima</span>}
          </>
        }
        comparacion={mermaCmp}
        formatoDelta={d => `${formatearNumero(d, 1)} pts`}
      >
        <p className="mt-1 text-xs text-text-muted">
          {tiposMerma.map(t => `${ETIQUETAS_MERMA[t.tipo as TipoMerma] ?? t.tipo} ${formatearKg(t.kg)}`).join(' · ')}
          {tiposMerma.length > 0 && ' · '}
          Sin clasificar {formatearKg(k.merma.sinClasificarKg)}
        </p>
      </TarjetaKpi>
    </GrillaKpis>
  );
}

export default KpisInventario;
