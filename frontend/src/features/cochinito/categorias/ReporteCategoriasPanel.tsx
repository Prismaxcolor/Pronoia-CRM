import { useMemo, useState } from 'react';
import type { ReporteCategorias } from '@shared/types/index.js';
import { formatearNumero } from '../../../components/ui';
import { obtenerReporteCategorias } from '../../../services/categoria-wallet-service';
import { formatearFecha } from '../../../lib/formato';
import { hoyLocal, rangoDeAtajo } from '../../../lib/rango-fechas';
import AccionesReporte from './AccionesReporte';
import RangoFechas from './RangoFechas';
import { armarArbol } from './categorias-logica';
import { descargarReporteCategoriasPDF } from './reporte-wallet-pdf';
import {
  etiquetaMoneda, filasPorMoneda, mensajeRango, monedasDelReporte, textoMovimientosAcceso, textoSeleccion, totalGeneral,
} from './reporte-wallet-datos';
import type { EstadoCategorias } from './useCategorias';

const TH = 'px-3 py-2 text-left text-xs font-semibold text-text-secondary';

function alternar(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
}

/** Reporte de ingresos, egresos y total por categoría y subcategoría, por rango de fechas y una moneda a la vez. */
function ReporteCategoriasPanel({ categorias, indice, error: errorCategorias }: Pick<EstadoCategorias, 'categorias' | 'indice' | 'error'>) {
  const [elegidas, setElegidas] = useState<string[]>([]);
  const [incluirSin, setIncluirSin] = useState(false);
  const [rango, setRango] = useState(() => rangoDeAtajo('mes', hoyLocal()));
  const [reporte, setReporte] = useState<ReporteCategorias | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const arbol = useMemo(() => armarArbol(categorias, true), [categorias]);
  const seleccion = textoSeleccion(elegidas, indice, incluirSin);

  const generar = async () => {
    const falta = mensajeRango(rango.desde, rango.hasta);
    if (falta) { setError(falta); return; }
    setError(null);
    setCargando(true);
    const r = await obtenerReporteCategorias({ categorias: elegidas, desde: rango.desde, hasta: rango.hasta, incluirSinCategoria: incluirSin });
    setCargando(false);
    if ('error' in r) { setError(r.error); setReporte(null); } else setReporte(r);
  };

  const casilla = (id: string, nombre: string, color: string, archivada: boolean, sangria: boolean) => (
    <label key={id} className={`flex cursor-pointer items-center gap-2 py-1 text-sm ${sangria ? 'pl-6' : ''}`}>
      <input type="checkbox" checked={elegidas.includes(id)} onChange={() => setElegidas(alternar(elegidas, id))} className="h-4 w-4 accent-brand-600" />
      <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-border" style={{ backgroundColor: color }} aria-hidden="true" />
      <span className={archivada ? 'text-text-muted' : ''}>{nombre}{archivada ? ' (archivada)' : ''}</span>
    </label>
  );

  return (
    <div>
      <div className="mb-4 rounded-xl border border-border bg-surface p-3 sm:p-4">
        <p className="mb-1 text-xs font-medium text-text-secondary">Categorías a incluir</p>
        <p className="mb-2 text-xs text-text-muted">Marca una categoría para incluir todas sus subcategorías, o solo subcategorías sueltas. Sin marcar ninguna se incluyen todas.</p>
        {errorCategorias ? <p className="text-sm text-red-600">{errorCategorias}</p> : (
          <div className="mb-3 max-h-56 overflow-y-auto rounded-lg border border-border px-3 py-1">
            {arbol.length === 0 && <p className="py-2 text-sm text-text-muted">Aún no hay categorías.</p>}
            {arbol.map(n => (
              <div key={n.categoria.id}>
                {casilla(n.categoria.id, n.categoria.nombre, n.categoria.color, !n.categoria.activo, false)}
                {n.hijas.map(h => casilla(h.id, h.nombre, h.color, !h.activo, true))}
              </div>
            ))}
          </div>
        )}
        <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={incluirSin} onChange={e => setIncluirSin(e.target.checked)} className="h-4 w-4 accent-brand-600" />
          Incluir los movimientos sin categoría
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <RangoFechas desde={rango.desde} hasta={rango.hasta} onCambiar={setRango} />
          <button type="button" onClick={generar} disabled={cargando} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {cargando ? 'Generando…' : 'Generar reporte'}
          </button>
        </div>
      </div>
      {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>}
      {reporte && <ResultadoCategorias reporte={reporte} seleccion={seleccion} />}
    </div>
  );
}

function ResultadoCategorias({ reporte, seleccion }: { reporte: ReporteCategorias; seleccion: string }) {
  const monedas = monedasDelReporte(reporte);
  const aviso = textoMovimientosAcceso(reporte.movimientosExcluidosPorAcceso);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">{seleccion} · del {formatearFecha(reporte.desde)} al {formatearFecha(reporte.hasta)}</p>
        <AccionesReporte generar={modo => descargarReporteCategoriasPDF(reporte, seleccion, modo)} />
      </div>
      {aviso && <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{aviso}</p>}
      {monedas.length === 0 && <p className="rounded-xl border border-dashed border-border-strong bg-surface px-4 py-6 text-center text-sm text-text-muted">No hay ingresos ni egresos con estos filtros en el periodo.</p>}
      {monedas.map(moneda => {
        const total = totalGeneral(reporte, moneda);
        return (
          <div key={moneda} className="mb-4 overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="min-w-full divide-y divide-border">
              <thead><tr>
                <th className={TH}>Categoría ({etiquetaMoneda(moneda)})</th>
                <th className={`${TH} text-right`}>Ingresos</th><th className={`${TH} text-right`}>Egresos</th><th className={`${TH} text-right`}>Total</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {filasPorMoneda(reporte, moneda).map((f, i) => (
                  <tr key={`${f.nombre}-${i}`} className={f.nivel === 0 ? 'font-medium' : 'text-text-secondary'}>
                    <td className={`px-3 py-2 text-sm ${f.nivel === 1 ? 'pl-9' : ''}`}>
                      <span className="mr-2 inline-block h-3 w-3 rounded-full border border-border align-middle" style={{ backgroundColor: f.color ?? 'transparent' }} aria-hidden="true" />{f.nombre}
                    </td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums">{formatearNumero(f.ingresos, 2)}</td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums">{formatearNumero(f.egresos, 2)}</td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums">{formatearNumero(f.total, 2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-surface-alt text-sm font-semibold"><tr>
                <td className="px-3 py-2">Total general</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatearNumero(total.ingresos, 2)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatearNumero(total.egresos, 2)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatearNumero(total.total, 2)}</td>
              </tr></tfoot>
            </table>
          </div>
        );
      })}
    </div>
  );
}

export default ReporteCategoriasPanel;
