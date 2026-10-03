import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import {
  obtenerReporteMerma,
  type AgrupacionMerma,
  type ReporteMerma,
} from '../../services/transformacion-service';
import { obtenerAlmacenes } from '../../services/almacen-service';
import { obtenerProductos } from '../../services/producto-service';
import type { Almacen, Producto } from '@shared/types/index.js';

const inputClass = 'px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';
const chipClass = 'px-3 py-1.5 border border-border rounded-lg text-text-secondary hover:bg-surface-alt';
const MS_DIA = 24 * 60 * 60 * 1000;

const fmt = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const fmtPct = (n: number) => `${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const iso = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function etiquetaPeriodo(periodo: string, agrupar: AgrupacionMerma): string {
  if (agrupar === 'dia') return periodo;
  if (agrupar === 'mes') return periodo.slice(0, 7);
  return `Semana del ${periodo}`;
}

const claseMerma = (kg: number) => (kg < 0 ? 'text-red-600' : 'text-text-primary');

function Resumen({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="bg-surface rounded-xl border border-border px-4 py-3">
      <p className="text-xs text-text-muted">{etiqueta}</p>
      <p className="text-lg font-semibold text-text-primary">{valor}</p>
    </div>
  );
}

function MermaPage() {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [almacenId, setAlmacenId] = useState('');
  const [productoId, setProductoId] = useState('');
  const [agrupar, setAgrupar] = useState<AgrupacionMerma>('mes');
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [reporte, setReporte] = useState<ReporteMerma | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void obtenerAlmacenes().then(setAlmacenes);
    void obtenerProductos().then(setProductos);
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setReporte(await obtenerReporteMerma({ desde, hasta, almacenId, productoId, agrupar }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el histórico de merma.');
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, almacenId, productoId, agrupar]);

  useEffect(() => { void cargar(); }, [cargar]);

  const productosOrdenados = useMemo(
    () => [...productos].sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [productos]
  );

  const ultimosDias = (dias: number) => {
    const hoy = new Date();
    setHasta(iso(hoy));
    setDesde(iso(new Date(hoy.getTime() - dias * MS_DIA)));
  };
  const esteMes = () => {
    const hoy = new Date();
    setDesde(iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)));
    setHasta(iso(hoy));
  };
  const todo = () => { setDesde(''); setHasta(''); };

  const totales = reporte?.totales;

  return (
    <div>
      <Link to="/transformaciones" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-brand-600 mb-3">
        <ArrowLeft size={14} /> Transformaciones
      </Link>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-text-primary">Merma</h1>
        <p className="text-sm text-text-secondary mt-1">
          Histórico de merma de las transformaciones completadas: peso neto de entrada menos todo lo que salió.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Desde</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Hasta</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Almacén</label>
          <select value={almacenId} onChange={e => setAlmacenId(e.target.value)} className={inputClass}>
            <option value="">Todos</option>
            {almacenes.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Material de entrada</label>
          <select value={productoId} onChange={e => setProductoId(e.target.value)} className={inputClass}>
            <option value="">Todos</option>
            {productosOrdenados.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Agrupar por</label>
          <select value={agrupar} onChange={e => setAgrupar(e.target.value as AgrupacionMerma)} className={inputClass}>
            <option value="dia">Día</option>
            <option value="semana">Semana</option>
            <option value="mes">Mes</option>
          </select>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mb-6 text-xs">
        <button type="button" onClick={() => ultimosDias(7)} className={chipClass}>7 días</button>
        <button type="button" onClick={() => ultimosDias(30)} className={chipClass}>30 días</button>
        <button type="button" onClick={esteMes} className={chipClass}>Este mes</button>
        <button type="button" onClick={todo} className={chipClass}>Todo</button>
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}

      {cargando && !reporte ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-text-muted" /></div>
      ) : reporte && totales && (
        <div className={cargando ? 'opacity-60 transition-opacity' : ''}>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
            <Resumen etiqueta="Transformaciones" valor={String(totales.transformaciones)} />
            <Resumen etiqueta="Entrada (kg)" valor={fmt(totales.kgEntrada)} />
            <Resumen etiqueta="Salida (kg)" valor={fmt(totales.kgSalida)} />
            <Resumen etiqueta="Merma (kg)" valor={fmt(totales.kgMerma)} />
            <Resumen etiqueta="Merma (%)" valor={fmtPct(totales.pctMerma)} />
          </div>

          <h2 className="text-sm font-semibold text-text-primary mb-2">Resumen por período</h2>
          <div className="bg-surface rounded-xl border border-border overflow-hidden mb-6">
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-muted">
                  <th className="px-5 py-3 font-medium">Período</th>
                  <th className="px-5 py-3 font-medium text-right">Transf.</th>
                  <th className="px-5 py-3 font-medium text-right">Entrada (kg)</th>
                  <th className="px-5 py-3 font-medium text-right">Salida (kg)</th>
                  <th className="px-5 py-3 font-medium text-right">Merma (kg)</th>
                  <th className="px-5 py-3 font-medium text-right">Merma %</th>
                </tr>
              </thead>
              <tbody>
                {reporte.periodos.length === 0 && (
                  <tr><td colSpan={6} className="px-5 py-8 text-center text-text-muted">Sin transformaciones completadas en este filtro.</td></tr>
                )}
                {[...reporte.periodos].reverse().map(p => (
                  <tr key={p.periodo} className="border-b border-border last:border-b-0">
                    <td className="px-5 py-3 text-text-primary whitespace-nowrap">{etiquetaPeriodo(p.periodo, reporte.agrupar)}</td>
                    <td className="px-5 py-3 text-right text-text-secondary">{p.transformaciones}</td>
                    <td className="px-5 py-3 text-right text-text-secondary">{fmt(p.kgEntrada)}</td>
                    <td className="px-5 py-3 text-right text-text-secondary">{fmt(p.kgSalida)}</td>
                    <td className={`px-5 py-3 text-right font-medium ${claseMerma(p.kgMerma)}`}>{fmt(p.kgMerma)}</td>
                    <td className={`px-5 py-3 text-right ${claseMerma(p.kgMerma)}`}>{fmtPct(p.pctMerma)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>

          <h2 className="text-sm font-semibold text-text-primary mb-2">Detalle por transformación</h2>
          <div className="bg-surface rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-muted">
                  <th className="px-5 py-3 font-medium">Fecha</th>
                  <th className="px-5 py-3 font-medium">Transformación</th>
                  <th className="px-5 py-3 font-medium">Entrada</th>
                  <th className="px-5 py-3 font-medium">Almacén</th>
                  <th className="px-5 py-3 font-medium text-right">Entrada (kg)</th>
                  <th className="px-5 py-3 font-medium text-right">Salida (kg)</th>
                  <th className="px-5 py-3 font-medium text-right">Merma (kg)</th>
                  <th className="px-5 py-3 font-medium text-right">Merma %</th>
                </tr>
              </thead>
              <tbody>
                {reporte.filas.length === 0 && (
                  <tr><td colSpan={8} className="px-5 py-8 text-center text-text-muted">Sin transformaciones completadas en este filtro.</td></tr>
                )}
                {reporte.filas.map(f => (
                  <tr key={f.id} className="border-b border-border last:border-b-0">
                    <td className="px-5 py-3 text-text-secondary whitespace-nowrap">{f.fecha}</td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <Link to={`/transformaciones/${f.id}`} className="text-text-primary hover:text-brand-600 font-medium">{f.codigo ?? '—'}</Link>
                    </td>
                    <td className="px-5 py-3 text-text-secondary">{f.entrada}</td>
                    <td className="px-5 py-3 text-text-secondary">{f.nombreAlmacen ?? '—'}</td>
                    <td className="px-5 py-3 text-right text-text-secondary">{fmt(f.kgEntrada)}</td>
                    <td className="px-5 py-3 text-right text-text-secondary">{fmt(f.kgSalida)}</td>
                    <td className={`px-5 py-3 text-right font-medium ${claseMerma(f.kgMerma)}`}>{fmt(f.kgMerma)}</td>
                    <td className={`px-5 py-3 text-right ${claseMerma(f.kgMerma)}`}>{fmtPct(f.pctMerma)}</td>
                  </tr>
                ))}
              </tbody>
              {reporte.filas.length > 0 && (
                <tfoot>
                  <tr className="border-t border-border bg-surface-alt font-semibold">
                    <td className="px-5 py-3" colSpan={4}>Total</td>
                    <td className="px-5 py-3 text-right">{fmt(totales.kgEntrada)}</td>
                    <td className="px-5 py-3 text-right">{fmt(totales.kgSalida)}</td>
                    <td className="px-5 py-3 text-right">{fmt(totales.kgMerma)}</td>
                    <td className="px-5 py-3 text-right">{fmtPct(totales.pctMerma)}</td>
                  </tr>
                </tfoot>
              )}
            </table></div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MermaPage;
