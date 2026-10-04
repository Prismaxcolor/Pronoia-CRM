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
        ayuda="Cuánto costó comprar el material suelto que hay hoy en el galpón (sin contar los lotes), en USD. Para cada material se multiplican sus kg por su costo promedio por kg, que sale de las facturas de compra (total pagado ÷ kg facturados). Solo cuentan los kg que tienen costo registrado. El valor estimado de venta de los lotes es otra cifra y no se suma a esta."
        estado={k.valor.oculto ? 'sinPermiso' : 'listo'}
        valor={formatearUsd(k.valor.costoUsd ?? 0)}
        subtitulo="costo de compra · solo material suelto (sin lotes)"
        comparacion={null}
      >
        <p className="mt-1 text-xs text-text-muted">
          El valor cuenta {formatearKg(k.valor.kgConCosto)} con costo de compra registrado
          {k.valor.kgSinCosto > 0 && <> ({formatearKg(k.valor.kgSinCosto)} sin costo: no entran en el valor)</>}
        </p>
        <div className="mt-2 border-t border-dashed border-border pt-2">
          <p className="text-xs text-text-muted">Venta estimada de los lotes (kg × precio por kg cargado a mano; otra cifra, no se suma a la de arriba)</p>
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
        ayuda="Todos los kg que hay hoy en los almacenes: material suelto más lotes. Es el stock de hoy. Debajo se ve cuántos kg hay en cada galpón."
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
        ayuda="Kg de los lotes de exportación (Lote 1 a 4) que una persona marcó como embalados y que el stock del lote todavía respalda; si parte ya se despachó o se transformó, ese tramo se descuenta. Lo que está en saca sin embalar no cuenta como listo."
        valor={formatearKg(k.listos.kg)}
        subtitulo="embalados en lotes de exportación (Lote 1 a 4)"
        comparacion={null}
      >
        <p className="mt-1 text-xs text-text-muted">{formatearKg(resumen.exportacion.enSacaKg)} más en saca (armados pero sin embalar)</p>
      </TarjetaKpi>

      <TarjetaKpi
        titulo="Merma del periodo"
        icono={<Percent size={16} />}
        ayuda={
          <>
            Porcentaje de los kg que entraron a transformaciones y no salieron como material: (kg que entraron − kg que salieron) ÷ kg que entraron.
            Es lo que se perdió como basura, plástico, tierra, hierro u otro no vendible. Cuenta solo las transformaciones completas del rango de fechas elegido y se compara con el período anterior de la misma duración.
            Por ejemplo: entran 1.000 kg y salen 920 kg → merma de 80 kg = 8 %.
            Se marca como alta desde {formatearPct(k.merma.umbralPct, 0)} (valor por defecto 8 %, configurable). Lo que nadie indicó qué era aparece como «sin clasificar».
          </>
        }
        estado={k.merma.transformaciones === 0 ? 'vacio' : 'listo'}
        mensajeVacio="Sin transformaciones en este periodo"
        valor={formatearPct(k.merma.pct)}
        tonoValor={k.merma.sobreUmbral ? 'peligro' : 'normal'}
        subtitulo={
          <>
            {formatearKg(k.merma.kgMerma)} de merma · se marca alta desde {formatearPct(k.merma.umbralPct, 0)}
            {k.merma.sobreUmbral && <span className="font-medium text-red-700"> · por encima del límite</span>}
          </>
        }
        comparacion={mermaCmp}
        formatoDelta={d => `${formatearNumero(d, 1)} pts`}
      >
        <p className="mt-1 text-xs text-text-muted">
          {tiposMerma.map(t => `${ETIQUETAS_MERMA[t.tipo as TipoMerma] ?? t.tipo} ${formatearKg(t.kg)}`).join(' · ')}
          {tiposMerma.length > 0 && ' · '}
          Sin clasificar (no se indicó qué era) {formatearKg(k.merma.sinClasificarKg)}
        </p>
      </TarjetaKpi>
    </GrillaKpis>
  );
}

export default KpisInventario;
