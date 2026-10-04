import { Coins, PackageX, Pencil, Store, TrendingUp } from 'lucide-react';
import { GrillaKpis, TarjetaKpi, formatearKg, formatearUsd, formatearUsdDecimales } from '../../components/ui';
import type { ResumenValor } from './lib/inventario-valor-kpis';

export interface VentaLotes { valorUsd: number; kgConPrecio: number; kgSinPrecio: number }

export type EstadoVenta = { estado: 'cargando' } | { estado: 'error'; mensaje: string } | { estado: 'listo'; dato: VentaLotes | null };

export interface InventarioValorKpisProps {
  resumen: ResumenValor;
  venta: EstadoVenta;
  onEditarCostos: () => void;
}

const BOTON = 'mt-2 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';

function InventarioValorKpis({ resumen, venta, onEditarCostos }: InventarioValorKpisProps) {
  const sinProductos = resumen.productos === 0;
  return (
    <GrillaKpis>
      <TarjetaKpi
        titulo="Valor del inventario a costo"
        icono={<Coins size={16} />}
        ayuda="Cuánto costó comprar el material suelto que hay hoy en los galpones (sin contar los lotes), en USD. Para cada producto con stock se multiplican sus kg por su costo por kg y se suman. Costo manual: el precio por kg que tú pones; manda sobre el promedio de las facturas. Si no hay costo manual se usa el promedio de las facturas de compra (total pagado ÷ kg facturados). Los kg sin costo no entran en el valor."
        estado={sinProductos ? 'vacio' : 'listo'}
        mensajeVacio="No hay productos con stock en los galpones"
        valor={formatearUsd(resumen.valorUsd)}
        subtitulo={`kg × costo por kg · ${resumen.productos - resumen.productosSinCosto} de ${resumen.productos} productos con costo`}
      />

      <TarjetaKpi
        titulo="Kg sin costo"
        icono={<PackageX size={16} />}
        ayuda="Kilos de productos con stock que todavía no tienen costo: ni costo manual ni facturas de compra. Por eso no se pueden valorizar y no entran en el valor del inventario. Pon un costo por kg a cada producto para que el valor sea completo."
        estado={sinProductos ? 'vacio' : 'listo'}
        mensajeVacio="No hay productos con stock en los galpones"
        valor={formatearKg(resumen.kgSinCosto)}
        subtitulo={resumen.productosSinCosto === 0 ? 'Todos los productos con stock tienen costo' : `${resumen.productosSinCosto} ${resumen.productosSinCosto === 1 ? 'producto' : 'productos'} sin costo`}
      >
        {resumen.productosSinCosto > 0 && (
          <>
            <p className="mt-1 text-xs font-medium text-amber-800">⚠ Falta costo: el valor de arriba está incompleto</p>
            <button type="button" onClick={onEditarCostos} className={BOTON}>
              <Pencil size={13} aria-hidden="true" /> Poner costos
            </button>
          </>
        )}
      </TarjetaKpi>

      <TarjetaKpi
        titulo="Valor estimado de venta de lotes"
        icono={<Store size={16} />}
        ayuda="Lo que valdrían los lotes si se vendieran al precio por kg que se cargó a mano en cada lote (precio estimado × kg del lote). Es una estimación de VENTA, no un costo: nunca se suma al valor del inventario a costo. Los lotes sin precio no entran."
        estado={venta.estado === 'cargando' ? 'cargando' : venta.estado === 'error' || !venta.dato || venta.dato.kgConPrecio <= 0 ? 'vacio' : 'listo'}
        mensajeVacio={venta.estado === 'error' ? 'No se pudo cargar el valor de los lotes' : 'Ningún lote tiene precio estimado todavía. Cárgalo en «Precio estimado de venta de los lotes», más abajo.'}
        valor={venta.estado === 'listo' && venta.dato ? formatearUsd(venta.dato.valorUsd) : undefined}
        subtitulo="precio estimado × kg · aparte, no se suma al costo"
      >
        {venta.estado === 'listo' && venta.dato && (
          <p className="mt-1 text-xs text-text-muted">
            {formatearKg(venta.dato.kgConPrecio)} con precio
            {venta.dato.kgSinPrecio > 0 && <span className="font-medium text-amber-800"> · ⚠ {formatearKg(venta.dato.kgSinPrecio)} de lotes sin precio</span>}
          </p>
        )}
      </TarjetaKpi>

      <TarjetaKpi
        titulo="Costo promedio por kg"
        icono={<TrendingUp size={16} />}
        ayuda="Lo que cuesta cada kilo en promedio: valor del inventario a costo ÷ kilos que tienen costo. Pesa más lo que más kilos hay. Por ejemplo: 900 USD en 1.300 kg dan 0,69 USD/kg. No cuenta los kg sin costo."
        estado={resumen.costoPromedioKg === null ? 'vacio' : 'listo'}
        mensajeVacio="Aún no hay kilos con costo para calcular el promedio"
        valor={resumen.costoPromedioKg === null ? undefined : formatearUsdDecimales(resumen.costoPromedioKg)}
        unidad="/kg"
        subtitulo={`valor ÷ ${formatearKg(resumen.kgConCosto)} con costo`}
      />
    </GrillaKpis>
  );
}

export default InventarioValorKpis;
