import { useEffect, useMemo, useState } from 'react';
import { Scale, DollarSign, Truck, Package, TrendingUp } from 'lucide-react';
import { obtenerMetricasCompras, type MetricaCompraLinea } from '../../services/metricas-service';

type Periodo = 7 | 15 | 30;
type Vista = 'material' | 'proveedor';

function fmtKg(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}
function fmtUsd(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fechaDesde(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

interface Agregado {
  id: string;
  nombre: string;
  kg: number;
  costo: number;
  /** Cuántos proveedores (vista material) o materiales (vista proveedor) distintos aportan a esta fila. */
  contraparteCount: number;
}

/** Agrupa líneas por una clave (productoId o proveedorId), sumando kg/costo
 *  y contando contrapartes distintas (proveedores por material, o materiales
 *  por proveedor) — misma función sirve para ambas vistas. */
function agregarPor(
  lineas: MetricaCompraLinea[],
  clave: (l: MetricaCompraLinea) => string,
  nombre: (l: MetricaCompraLinea) => string,
  contraparte: (l: MetricaCompraLinea) => string
): Agregado[] {
  const mapa = new Map<string, { nombre: string; kg: number; costo: number; contrapartes: Set<string> }>();
  for (const l of lineas) {
    const id = clave(l);
    const ex = mapa.get(id);
    if (ex) {
      ex.kg += l.kg;
      ex.costo += l.costo;
      ex.contrapartes.add(contraparte(l));
    } else {
      mapa.set(id, { nombre: nombre(l), kg: l.kg, costo: l.costo, contrapartes: new Set([contraparte(l)]) });
    }
  }
  return Array.from(mapa.entries())
    .map(([id, v]) => ({ id, nombre: v.nombre, kg: v.kg, costo: v.costo, contraparteCount: v.contrapartes.size }))
    .sort((a, b) => b.kg - a.kg);
}

/** Fila con barra horizontal proporcional al máximo del grupo — la "barra
 *  simple con Tailwind" que reemplaza una librería de gráficos. */
function FilaBarra({ item, maxKg, etiquetaContraparte, seleccionada, onClick }: {
  item: Agregado;
  maxKg: number;
  etiquetaContraparte: string;
  seleccionada: boolean;
  onClick: () => void;
}) {
  const costoPromedio = item.kg > 0 ? item.costo / item.kg : 0;
  const anchoPct = maxKg > 0 ? Math.max((item.kg / maxKg) * 100, 3) : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${
        seleccionada ? 'bg-brand-50 border border-brand-300' : 'hover:bg-surface-alt border border-transparent'
      }`}
    >
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-sm font-medium text-text-primary truncate">{item.nombre}</span>
        <span className="text-sm font-semibold text-text-primary shrink-0">{fmtKg(item.kg)} kg</span>
      </div>
      <div className="h-2 bg-surface-alt rounded-full overflow-hidden mb-1.5">
        <div className="h-full bg-brand-500 rounded-full" style={{ width: `${anchoPct}%` }} />
      </div>
      <div className="flex items-center justify-between text-xs text-text-muted">
        <span>{item.contraparteCount} {etiquetaContraparte}{item.contraparteCount === 1 ? '' : 's'}</span>
        <span>Promedio ${fmtUsd(costoPromedio)}/kg</span>
      </div>
    </button>
  );
}

function MetricasPage() {
  const [lineas, setLineas] = useState<MetricaCompraLinea[]>([]);
  const [cargando, setCargando] = useState(true);
  const [periodo, setPeriodo] = useState<Periodo>(30);
  const [vista, setVista] = useState<Vista>('material');
  const [materialSel, setMaterialSel] = useState<string | null>(null);
  const [proveedorSel, setProveedorSel] = useState<string | null>(null);

  useEffect(() => {
    obtenerMetricasCompras().then(setLineas).finally(() => setCargando(false));
  }, []);

  const lineasPeriodo = useMemo(() => {
    const corte = fechaDesde(periodo);
    return lineas.filter(l => l.fecha >= corte);
  }, [lineas, periodo]);

  const resumen = useMemo(() => {
    const kgTotal = lineasPeriodo.reduce((s, l) => s + l.kg, 0);
    const costoTotal = lineasPeriodo.reduce((s, l) => s + l.costo, 0);
    const proveedores = new Set(lineasPeriodo.map(l => l.proveedorId));
    const materiales = new Set(lineasPeriodo.map(l => l.productoId ?? l.nombreProducto));
    return {
      kgTotal,
      costoTotal,
      costoPromedioKg: kgTotal > 0 ? costoTotal / kgTotal : 0,
      proveedoresCount: proveedores.size,
      materialesCount: materiales.size,
    };
  }, [lineasPeriodo]);

  const porMaterial = useMemo(
    () => agregarPor(lineasPeriodo, l => l.productoId ?? l.nombreProducto, l => l.nombreProducto, l => l.proveedorId),
    [lineasPeriodo]
  );
  const porProveedor = useMemo(
    () => agregarPor(lineasPeriodo, l => l.proveedorId, l => l.nombreProveedor, l => l.productoId ?? l.nombreProducto),
    [lineasPeriodo]
  );

  const maxKgMaterial = porMaterial[0]?.kg ?? 0;
  const maxKgProveedor = porProveedor[0]?.kg ?? 0;

  const detalleMaterial = useMemo(() => {
    if (!materialSel) return null;
    const filtradas = lineasPeriodo.filter(l => (l.productoId ?? l.nombreProducto) === materialSel);
    const nombre = filtradas[0]?.nombreProducto ?? '—';
    const proveedores = agregarPor(filtradas, l => l.proveedorId, l => l.nombreProveedor, l => l.proveedorId);
    return { nombre, proveedores, maxKg: proveedores[0]?.kg ?? 0 };
  }, [lineasPeriodo, materialSel]);

  const detalleProveedor = useMemo(() => {
    if (!proveedorSel) return null;
    const filtradas = lineasPeriodo.filter(l => l.proveedorId === proveedorSel);
    const nombre = filtradas[0]?.nombreProveedor ?? '—';
    const kgTotal = filtradas.reduce((s, l) => s + l.kg, 0);
    const costoTotal = filtradas.reduce((s, l) => s + l.costo, 0);
    const materiales = agregarPor(filtradas, l => l.productoId ?? l.nombreProducto, l => l.nombreProducto, l => l.proveedorId);
    return {
      nombre,
      kgTotal,
      costoPromedioKg: kgTotal > 0 ? costoTotal / kgTotal : 0,
      materiales,
      maxKg: materiales[0]?.kg ?? 0,
    };
  }, [lineasPeriodo, proveedorSel]);

  if (cargando) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  const stats = [
    { label: 'Kilos totales', valor: `${fmtKg(resumen.kgTotal)} kg`, sub: `${fmtKg(resumen.kgTotal / 1000)} t`, icon: <Scale size={20} />, color: 'bg-brand-500' },
    { label: 'Costo total', valor: `$${fmtUsd(resumen.costoTotal)}`, sub: null, icon: <DollarSign size={20} />, color: 'bg-tipo-azul' },
    { label: 'Costo promedio', valor: `$${fmtUsd(resumen.costoPromedioKg)}/kg`, sub: null, icon: <TrendingUp size={20} />, color: 'bg-brand-700' },
    { label: 'Proveedores', valor: resumen.proveedoresCount.toString(), sub: null, icon: <Truck size={20} />, color: 'bg-brand-600' },
    { label: 'Materiales', valor: resumen.materialesCount.toString(), sub: null, icon: <Package size={20} />, color: 'bg-red-500' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Métricas de compras</h1>
          <p className="text-sm text-text-secondary mt-1">Kilos y costos comprados a proveedores, por material y por proveedor.</p>
        </div>
        <div className="flex rounded-lg overflow-hidden border border-border text-sm w-fit shrink-0">
          {([7, 15, 30] as Periodo[]).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriodo(p)}
              className={`px-4 py-1.5 ${periodo === p ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}
            >
              {p} días
            </button>
          ))}
        </div>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        {stats.map(stat => (
          <div key={stat.label} className="bg-surface rounded-xl p-5 shadow-sm border border-border">
            <div className="flex items-center gap-3 mb-3">
              <div className={`${stat.color} text-white p-2 rounded-lg`}>{stat.icon}</div>
              <span className="text-text-secondary text-sm">{stat.label}</span>
            </div>
            <p className="text-2xl font-bold text-text-primary">{stat.valor}</p>
            {stat.sub && <p className="text-xs text-text-muted mt-0.5">{stat.sub}</p>}
          </div>
        ))}
      </div>

      {lineasPeriodo.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-8 text-center text-text-muted">
          No hay compras registradas en los últimos {periodo} días.
        </div>
      ) : (
        <>
          {/* Vista: por material / por proveedor */}
          <div className="flex rounded-lg overflow-hidden border border-border text-sm w-fit mb-4">
            <button type="button" onClick={() => setVista('material')} className={`px-4 py-1.5 ${vista === 'material' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
              Por material
            </button>
            <button type="button" onClick={() => setVista('proveedor')} className={`px-4 py-1.5 ${vista === 'proveedor' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
              Por proveedor
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {vista === 'material' ? (
              <div className="bg-surface rounded-xl border border-border p-4">
                <h2 className="text-sm font-semibold text-text-primary mb-3">Materiales ({porMaterial.length})</h2>
                <div className="space-y-1">
                  {porMaterial.map(m => (
                    <FilaBarra
                      key={m.id}
                      item={m}
                      maxKg={maxKgMaterial}
                      etiquetaContraparte="proveedor"
                      seleccionada={materialSel === m.id}
                      onClick={() => setMaterialSel(prev => (prev === m.id ? null : m.id))}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-surface rounded-xl border border-border p-4">
                <h2 className="text-sm font-semibold text-text-primary mb-3">Proveedores ({porProveedor.length})</h2>
                <div className="space-y-1">
                  {porProveedor.map(p => (
                    <FilaBarra
                      key={p.id}
                      item={p}
                      maxKg={maxKgProveedor}
                      etiquetaContraparte="material"
                      seleccionada={proveedorSel === p.id}
                      onClick={() => setProveedorSel(prev => (prev === p.id ? null : p.id))}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Detalle del ítem seleccionado */}
            <div className="bg-surface rounded-xl border border-border p-4">
              {vista === 'material' ? (
                detalleMaterial ? (
                  <>
                    <h2 className="text-sm font-semibold text-text-primary mb-3">
                      Proveedores de "{detalleMaterial.nombre}"
                    </h2>
                    <div className="space-y-1">
                      {detalleMaterial.proveedores.map(p => (
                        <FilaBarra key={p.id} item={p} maxKg={detalleMaterial.maxKg} etiquetaContraparte="material" seleccionada={false} onClick={() => {}} />
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-text-muted h-full flex items-center justify-center py-12">
                    Selecciona un material para ver qué proveedores lo trajeron.
                  </p>
                )
              ) : detalleProveedor ? (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-text-primary">Materiales de "{detalleProveedor.nombre}"</h2>
                    <span className="text-xs text-text-muted">
                      {fmtKg(detalleProveedor.kgTotal)} kg · promedio ${fmtUsd(detalleProveedor.costoPromedioKg)}/kg
                    </span>
                  </div>
                  <div className="space-y-1">
                    {detalleProveedor.materiales.map(m => (
                      <FilaBarra key={m.id} item={m} maxKg={detalleProveedor.maxKg} etiquetaContraparte="proveedor" seleccionada={false} onClick={() => {}} />
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-text-muted h-full flex items-center justify-center py-12">
                  Selecciona un proveedor para ver qué materiales trajo.
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default MetricasPage;
