import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { InsigniaEstado, TablaDatos, formatearFecha, formatearKgDecimales, formatearUsdDecimales, infoEstado, type ColumnaTabla, type TablaDatosProps } from '../../components/ui';
import { cuentaComoFacturada, fechaEmision, pesoFactura, saldoCompra } from '../../lib/facturas-kpis';
import type { FacturaCV, TipoFactura } from '../../services/factura-cv-service';

/** Tabla del historial de facturas (se carga con React.lazy después de los indicadores). Ordenable, exportable a CSV y,
 *  en móvil, tarjetas apiladas. El N° de control es el enlace al detalle. Las columnas de pago existen solo en compras:
 *  en ventas el sistema no registra cobros, así que no se muestran "pagado" ni "saldo". */
interface Props {
  facturas: readonly FacturaCV[];
  tipo: TipoFactura;
  ruta: string;
  cargando?: boolean;
  vacio?: TablaDatosProps<FacturaCV>['vacio'];
}

/** Resumen de materiales: el nombre si es uno, "N materiales" si son varios. */
function resumenMateriales(f: FacturaCV): string {
  if (f.items.length === 0) return '—';
  if (f.items.length === 1) return f.items[0].nombreProducto ?? 'material';
  return `${f.items.length} materiales`;
}

const suma = (filas: readonly FacturaCV[], valor: (f: FacturaCV) => number): number =>
  filas.filter(cuentaComoFacturada).reduce((acc, f) => acc + valor(f), 0);

function FacturaTabla({ facturas, tipo, ruta, cargando, vacio }: Props) {
  const esCompra = tipo === 'compra';
  const labelEntidad = esCompra ? 'Proveedor' : 'Cliente';

  const columnas = useMemo<ColumnaTabla<FacturaCV>[]>(() => {
    const base: ColumnaTabla<FacturaCV>[] = [
      {
        clave: 'codigo', titulo: 'N° control', valorOrden: f => f.codigo ?? '',
        celda: f => (
          <Link to={`${ruta}/${f.id}`} className="font-medium text-brand-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
            {f.codigo ?? `N.º ${f.id.slice(0, 8)}`}
          </Link>
        ),
        claseCelda: 'whitespace-nowrap',
      },
      { clave: 'fecha', titulo: 'Fecha', valorOrden: f => f.createdAt, celda: f => formatearFecha(fechaEmision(f)), valorCsv: f => formatearFecha(fechaEmision(f)), claseCelda: 'whitespace-nowrap' },
      { clave: 'entidad', titulo: labelEntidad, valorOrden: f => f.nombreEntidad ?? '' , celda: f => f.nombreEntidad ?? '—' },
      { clave: 'materiales', titulo: 'Materiales', valorOrden: f => resumenMateriales(f), ocultaEnMovil: true },
      {
        clave: 'kg', titulo: 'Peso', alinear: 'derecha', valorOrden: f => pesoFactura(f), celda: f => formatearKgDecimales(pesoFactura(f)),
        total: filas => formatearKgDecimales(suma(filas, pesoFactura)), decimalesCsv: 2,
        ayuda: 'Kg de todas las líneas de la factura, ya sin los descuentos aplicados al facturar.',
      },
      {
        clave: 'total', titulo: 'Total', alinear: 'derecha', valorOrden: f => f.total, celda: f => formatearUsdDecimales(f.total),
        total: filas => formatearUsdDecimales(suma(filas, f => f.total)), decimalesCsv: 2,
      },
    ];
    if (esCompra) {
      base.push(
        {
          clave: 'pagado', titulo: 'Pagado', alinear: 'derecha', valorOrden: f => (cuentaComoFacturada(f) ? f.montoPagado : null),
          celda: f => (cuentaComoFacturada(f) ? formatearUsdDecimales(f.montoPagado) : '—'),
          total: filas => formatearUsdDecimales(suma(filas, f => f.montoPagado)), decimalesCsv: 2,
        },
        {
          clave: 'saldo', titulo: 'Saldo', alinear: 'derecha', valorOrden: f => saldoCompra(f),
          celda: f => formatearUsdDecimales(saldoCompra(f)),
          total: filas => formatearUsdDecimales(suma(filas, saldoCompra)), decimalesCsv: 2,
          ayuda: 'Lo que falta por pagar: total menos lo pagado. Solo las facturas emitidas tienen saldo; las pagadas y las anuladas no.',
        },
      );
    }
    base.push({
      clave: 'estado', titulo: 'Estado', valorOrden: f => infoEstado(f.estado).etiqueta,
      celda: f => <InsigniaEstado estado={f.estado} />,
    });
    return base;
  }, [esCompra, labelEntidad, ruta]);

  const tarjetaMovil = (f: FacturaCV) => (
    <>
      <div className="flex items-start justify-between gap-2">
        <Link to={`${ruta}/${f.id}`} className="text-sm font-semibold text-brand-700 underline-offset-2 hover:underline">{f.codigo ?? `N.º ${f.id.slice(0, 8)}`}</Link>
        <InsigniaEstado estado={f.estado} />
      </div>
      <p className="mt-0.5 text-sm text-text-primary">{f.nombreEntidad ?? '—'}</p>
      <p className="text-xs text-text-secondary">{formatearFecha(fechaEmision(f))} · {resumenMateriales(f)} · {formatearKgDecimales(pesoFactura(f))}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 text-xs">
        <div><dt className="text-text-secondary">Total</dt><dd className="font-medium tabular-nums">{formatearUsdDecimales(f.total)}</dd></div>
        {esCompra && <div><dt className="text-text-secondary">Saldo</dt><dd className="font-medium tabular-nums">{formatearUsdDecimales(saldoCompra(f))}</dd></div>}
      </dl>
    </>
  );

  return (
    <TablaDatos
      titulo={`Facturas de ${esCompra ? 'compra' : 'venta'}`}
      columnas={columnas}
      filas={facturas}
      claveFila={f => f.id}
      etiquetaFila={f => f.codigo ?? f.id}
      cargando={cargando}
      vacio={vacio}
      ordenInicial={{ columna: 'fecha', sentido: 'desc' }}
      totales={{ etiqueta: 'Totales (solo emitidas y pagadas)' }}
      exportar={{ nombreArchivo: `facturas-${tipo}` }}
      tarjetaMovil={tarjetaMovil}
      paginacion={{ tamano: 25 }}
    />
  );
}

export default FacturaTabla;
