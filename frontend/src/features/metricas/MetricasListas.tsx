import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import {
  BotonAccion, Bloque, Chip, ControlSegmentado, EstadoVacio, construirCsv, exportarCsv, formatearFecha, formatearKg, formatearNumero,
  formatearUsdDecimales, nombreArchivoCsv, type ColumnaCsv,
} from '../../components/ui';
import { claveMaterial, filtrarLineas, filtrarPorNombre, porMaterialDe, porProveedorDe, type Agregado } from '../../lib/metricas-kpis';
import type { MetricaCompraLinea } from '../../services/metricas-service';

export type VistaMetricas = 'material' | 'proveedor';

export interface MetricasListasProps {
  lineas: readonly MetricaCompraLinea[];
  vista: VistaMetricas;
  material?: string;
  proveedor?: string;
  busqueda?: string;
  puedeVerCostos: boolean;
  onCambiar: (cambios: { vista?: VistaMetricas; material?: string; proveedor?: string }) => void;
}

/** Fila con barra proporcional al máximo del grupo. Es un botón alternable (aria-pressed): elegirla filtra el detalle. */
function FilaBarra({ item, maxKg, rango, etiquetaContraparte, seleccionada, puedeVerCostos, onClick }: {
  item: Agregado; maxKg: number; rango: number; etiquetaContraparte: string; seleccionada: boolean; puedeVerCostos: boolean; onClick: () => void;
}) {
  const promedio = item.kg > 0 ? item.costo / item.kg : 0;
  const ancho = maxKg > 0 ? Math.max((item.kg / maxKg) * 100, 3) : 0;
  const destacada = rango < 3;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={seleccionada}
      className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${seleccionada ? 'border-brand-300 bg-brand-50' : 'border-transparent hover:bg-surface-hover'}`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-text-primary">
          {destacada && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-label="Entre los 3 mayores" />}
          <span className="truncate">{item.nombre}</span>
          {item.categoria && <span className="shrink-0 text-xs font-normal text-text-secondary">· {item.categoria}</span>}
        </span>
        <span className="flex shrink-0 items-baseline gap-3 tabular-nums">
          <span className="text-sm font-semibold text-text-primary">{formatearKg(item.kg)}</span>
          {puedeVerCostos && <span className="text-sm font-semibold text-brand-700">{formatearUsdDecimales(promedio)}<span className="text-xs font-normal text-text-secondary">/kg</span></span>}
        </span>
      </div>
      <div className="mb-1.5 h-2 overflow-hidden rounded-full bg-surface-hover" aria-hidden="true">
        <div className={`h-full rounded-full ${destacada ? 'bg-brand-500' : 'bg-brand-300'}`} style={{ width: `${ancho}%` }} />
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-text-secondary">
        <span>{item.comprasCount} {item.comprasCount === 1 ? 'compra' : 'compras'} · {item.contraparteCount} {etiquetaContraparte}{item.contraparteCount === 1 ? '' : 's'}</span>
        {puedeVerCostos && item.precioMaxKg > item.precioMinKg && <span className="tabular-nums">rango {formatearUsdDecimales(item.precioMinKg)}–{formatearUsdDecimales(item.precioMaxKg)}/kg</span>}
      </div>
    </button>
  );
}

function columnasCsv(vista: VistaMetricas, puedeVerCostos: boolean): ColumnaCsv<Agregado>[] {
  const base: ColumnaCsv<Agregado>[] = [{ titulo: vista === 'material' ? 'Material' : 'Proveedor', valor: a => a.nombre }];
  if (vista === 'material') base.push({ titulo: 'Categoría', valor: a => a.categoria });
  base.push(
    { titulo: 'Kg', valor: a => a.kg, decimales: 1 },
    { titulo: 'Compras', valor: a => a.comprasCount, decimales: 0 },
    { titulo: vista === 'material' ? 'Proveedores' : 'Materiales', valor: a => a.contraparteCount, decimales: 0 },
  );
  if (puedeVerCostos) {
    base.push(
      { titulo: 'Costo USD', valor: a => a.costo },
      { titulo: 'USD por kg', valor: a => (a.kg > 0 ? a.costo / a.kg : null) },
      { titulo: 'USD por kg mínimo', valor: a => a.precioMinKg },
      { titulo: 'USD por kg máximo', valor: a => a.precioMaxKg },
    );
  }
  return base;
}

function MetricasListas({ lineas, vista, material, proveedor, busqueda, puedeVerCostos, onCambiar }: MetricasListasProps) {
  const porMaterial = useMemo(() => porMaterialDe(lineas), [lineas]);
  const porProveedor = useMemo(() => porProveedorDe(lineas), [lineas]);
  const activa = vista === 'material' ? porMaterial : porProveedor;
  const filtrada = useMemo(() => filtrarPorNombre(activa, busqueda), [activa, busqueda]);
  const maxKg = activa[0]?.kg ?? 0;

  const nombreMaterial = material ? lineas.find(l => claveMaterial(l) === material)?.nombreProducto ?? null : null;
  const nombreProveedor = proveedor ? lineas.find(l => l.proveedorId === proveedor)?.nombreProveedor ?? null : null;
  const alternarMaterial = (id: string) => onCambiar({ material: material === id ? undefined : id });
  const alternarProveedor = (id: string) => onCambiar({ proveedor: proveedor === id ? undefined : id });

  const facturasCruce = useMemo(
    () => (material && proveedor ? filtrarLineas(lineas, material, proveedor).sort((a, b) => b.fecha.localeCompare(a.fecha)) : null),
    [lineas, material, proveedor],
  );
  const detalle = useMemo(() => {
    if (facturasCruce) return null;
    if (material) return { titulo: `Proveedores de «${nombreMaterial ?? material}»`, esProveedor: true, agregado: porProveedorDe(filtrarLineas(lineas, material, undefined)) };
    if (proveedor) return { titulo: `Materiales de «${nombreProveedor ?? proveedor}»`, esProveedor: false, agregado: porMaterialDe(filtrarLineas(lineas, undefined, proveedor)) };
    return null;
  }, [lineas, material, proveedor, facturasCruce, nombreMaterial, nombreProveedor]);

  const exportar = () => {
    exportarCsv(nombreArchivoCsv(`metricas-compras-por-${vista}`, new Date()), construirCsv(columnasCsv(vista, puedeVerCostos), filtrada));
  };

  return (
    <Bloque
      titulo="Detalle de compras"
      queEstasViendo={`cada ${vista === 'material' ? 'material' : 'proveedor'} ordenado de más a menos kilos comprados en el periodo. En cada fila: los kilos, el costo promedio por kg (costo ÷ kilos; solo con permiso de facturación), cuántas compras fueron y, si el precio varió, el rango entre el kg más barato y el más caro pagado. El punto marca los 3 con más kilos. Elige uno para ver ${vista === 'material' ? 'a qué proveedores se les compró' : 'qué materiales se le compraron'}, y elige los dos para llegar hasta las compras.`}
      acciones={
        <span className="print:hidden">
          <BotonAccion variante="secundario" onClick={exportar} disabled={filtrada.length === 0} icono={<Download size={16} />}>Exportar CSV</BotonAccion>
        </span>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
        <ControlSegmentado
          etiquetaAria="Agrupar compras por"
          valor={vista}
          onCambiar={v => onCambiar({ vista: v })}
          opciones={[
            { valor: 'material', etiqueta: 'Por material', sufijo: porMaterial.length },
            { valor: 'proveedor', etiqueta: 'Por proveedor', sufijo: porProveedor.length },
          ]}
        />
        {nombreMaterial && <Chip onQuitar={() => onCambiar({ material: undefined })} etiquetaQuitar={`Quitar material ${nombreMaterial}`}>Material: {nombreMaterial}</Chip>}
        {nombreProveedor && <Chip onQuitar={() => onCambiar({ proveedor: undefined })} etiquetaQuitar={`Quitar proveedor ${nombreProveedor}`}>Proveedor: {nombreProveedor}</Chip>}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section aria-label={vista === 'material' ? 'Materiales' : 'Proveedores'} className="rounded-xl border border-border bg-surface p-4">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">{vista === 'material' ? 'Materiales' : 'Proveedores'} ({filtrada.length})</h3>
          <div className="max-h-[32rem] space-y-1 overflow-y-auto">
            {filtrada.length === 0
              ? <p className="py-6 text-center text-sm text-text-secondary">Sin resultados para «{busqueda}».</p>
              : filtrada.map((item, idx) => (
                <FilaBarra
                  key={item.id}
                  item={item}
                  maxKg={maxKg}
                  rango={idx}
                  etiquetaContraparte={vista === 'material' ? 'proveedor' : 'material'}
                  seleccionada={vista === 'material' ? material === item.id : proveedor === item.id}
                  puedeVerCostos={puedeVerCostos}
                  onClick={() => (vista === 'material' ? alternarMaterial(item.id) : alternarProveedor(item.id))}
                />
              ))}
          </div>
        </section>

        <section aria-label="Detalle de la selección" className="rounded-xl border border-border bg-surface p-4">
          {facturasCruce ? (
            <>
              <h3 className="mb-3 text-sm font-semibold text-text-primary">Compras de «{nombreMaterial}» a «{nombreProveedor}» ({facturasCruce.length})</h3>
              <ul className="divide-y divide-border">
                {facturasCruce.map(l => {
                  const contenido = (
                    <>
                      <span><span className="font-medium text-text-primary">{l.codigoFactura ?? l.facturaId.slice(0, 8)}</span><span className="text-text-secondary"> · {formatearFecha(l.fecha)}</span></span>
                      <span className="tabular-nums text-text-primary">{formatearKg(l.kg)}{puedeVerCostos && ` · ${formatearUsdDecimales(l.costo)}`}</span>
                    </>
                  );
                  const clase = 'flex items-center justify-between gap-3 py-2.5 text-sm';
                  return (
                    <li key={`${l.facturaId}-${claveMaterial(l)}`}>
                      {puedeVerCostos
                        ? <Link to={`/compras/${l.facturaId}`} className={`${clase} -mx-2 rounded px-2 hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400`}>{contenido}</Link>
                        : <div className={clase}>{contenido}</div>}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : detalle ? (
            <>
              <h3 className="mb-3 text-sm font-semibold text-text-primary">{detalle.titulo}</h3>
              {detalle.agregado.length === 0
                ? <p className="py-6 text-center text-sm text-text-secondary">Sin datos en este periodo.</p>
                : (
                  <div className="space-y-1">
                    {detalle.agregado.map((item, idx) => (
                      <FilaBarra
                        key={item.id}
                        item={item}
                        maxKg={detalle.agregado[0]?.kg ?? 0}
                        rango={idx}
                        etiquetaContraparte={detalle.esProveedor ? 'material' : 'proveedor'}
                        seleccionada={detalle.esProveedor ? proveedor === item.id : material === item.id}
                        puedeVerCostos={puedeVerCostos}
                        onClick={() => (detalle.esProveedor ? alternarProveedor(item.id) : alternarMaterial(item.id))}
                      />
                    ))}
                  </div>
                )}
            </>
          ) : (
            <EstadoVacio
              mensaje={`Elige un ${vista === 'material' ? 'material' : 'proveedor'} de la lista`}
              descripcion={`Aquí verás ${vista === 'material' ? 'a qué proveedores se les compró' : 'qué materiales se le compraron'}. Si eliges también ${vista === 'material' ? 'un proveedor' : 'un material'}, llegas hasta cada compra.`}
            />
          )}
        </section>
      </div>
      <p className="mt-2 text-xs text-text-secondary print:hidden">{formatearNumero(filtrada.length, 0)} de {formatearNumero(activa.length, 0)} {vista === 'material' ? 'materiales' : 'proveedores'} en la lista y en el CSV.</p>
    </Bloque>
  );
}

export default MetricasListas;
