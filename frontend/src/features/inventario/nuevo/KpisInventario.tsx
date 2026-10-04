import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Boxes, PackageCheck, Percent, Warehouse } from 'lucide-react';
import {
  compararConPeriodoAnterior,
  derivarKpis,
  formatearKg,
  formatearNumero,
  formatearPct,
  type FiltrosPantalla,
} from '../../../lib/inventario-nuevo';
import type { DetallePantalla } from '@shared/types/inventario-pantalla.js';
import { ETIQUETAS_MERMA, type TipoMerma } from '../../../lib/merma-tipificada';
import { AYUDA_ITEMS_CON_STOCK, ORDEN_VISTAS, claveParametros, contarItemsPorVista, etiquetaVista, parametrosPantalla } from '../../../lib/inventario-pantalla';
import type { ResumenInventario } from '../../../services/inventario-resumen-service';
import { obtenerDetallePantalla } from '../../../services/inventario-pantalla-service';
import { useAuth } from '../../../hooks/use-auth-context';
import { useDatosPantalla } from './useDatosPantalla';
import { GrillaKpis, SkeletonKpis, TarjetaKpi } from '../../../components/ui';

/** Esqueleto de los 4 KPIs mientras carga el resumen. */
export const KpisSkeleton = SkeletonKpis;

interface Props {
  resumen: ResumenInventario;
  /** Filtros de la URL: de ellos solo se usan el rango y el almacén (la tarjeta de ítems no depende de categoría ni buscador). */
  filtros: FiltrosPantalla;
  /** Sube cuando hay que volver a pedir los datos propios de la tarjeta de ítems (misma señal que la tabla de detalle). */
  recarga?: number;
}

/** «Productos y lotes con stock»: cuántos ítems tienen kg hoy en el galpón, repartidos por vista. Solo kilos.
 *  Pide el detalle sin categoría ni buscador y con límite 1: los grupos del servidor cubren todas las filas. */
function TarjetaItemsConStock({ filtros, recarga }: { filtros: FiltrosPantalla; recarga: number }) {
  const { tienePermiso } = useAuth();
  const params = useMemo(
    () => parametrosPantalla({ desde: filtros.desde, hasta: filtros.hasta, almacen: filtros.almacen }, { limite: 1, sinValor: true }),
    [filtros.desde, filtros.hasta, filtros.almacen],
  );
  const { dato, error, recargar } = useDatosPantalla<DetallePantalla>(`${claveParametros(params)}|r${recarga}`, () => obtenerDetallePantalla(params));
  const conteo = useMemo(() => (dato ? contarItemsPorVista(dato.grupos) : null), [dato]);
  const estado = error && !dato ? 'vacio' : !conteo ? 'cargando' : 'listo';

  return (
    <TarjetaKpi
      titulo="Productos y lotes con stock"
      icono={<Boxes size={16} />}
      ayuda={AYUDA_ITEMS_CON_STOCK}
      estado={estado}
      mensajeVacio="No se pudo contar"
      valor={conteo ? `${formatearNumero(conteo.total, 0)} ítems` : '—'}
      subtitulo="con kg en el galpón hoy"
      comparacion={null}
    >
      {error && !dato && (
        <button type="button" onClick={recargar} className="mt-1 text-xs font-medium text-brand-700 underline underline-offset-2">Reintentar</button>
      )}
      {conteo && (
        <ul className="mt-1 text-xs text-text-secondary">
          {ORDEN_VISTAS.filter(v => conteo.porVista[v] > 0 || v !== 'otras').map(v => (
            <li key={v} className="flex justify-between gap-2"><span>{etiquetaVista(v)}</span><span className="tabular-nums">{formatearNumero(conteo.porVista[v], 0)}</span></li>
          ))}
        </ul>
      )}
      {tienePermiso('facturacion', 'ver') && (
        <Link to="/metricas?seccion=inventario" className="mt-2 inline-block text-xs font-medium text-brand-700 underline underline-offset-2">Ver valor del inventario en Métricas →</Link>
      )}
    </TarjetaKpi>
  );
}

function KpisInventario({ resumen, filtros, recarga = 0 }: Props) {
  const k = derivarKpis(resumen);
  const mermaCmp = compararConPeriodoAnterior(k.merma.pct, k.merma.pctAnterior, 'baja');
  const tiposMerma = k.merma.porTipo.filter(t => t.kg > 0);

  return (
    <GrillaKpis>
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

      <TarjetaItemsConStock filtros={filtros} recarga={recarga} />

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
