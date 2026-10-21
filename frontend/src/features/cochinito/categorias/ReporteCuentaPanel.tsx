import { useEffect, useMemo, useState } from 'react';
import type { Banca, ReporteCuenta } from '@shared/types/index.js';
import { formatearNumero } from '../../../components/ui';
import { obtenerBancas } from '../../../services/banca-service';
import { obtenerReporteCuenta } from '../../../services/categoria-wallet-service';
import { formatearFecha } from '../../../lib/formato';
import { hoyLocal, rangoDeAtajo } from '../../../lib/rango-fechas';
import { numeroMovimiento } from '../detalle-movimiento';
import AccionesReporte from './AccionesReporte';
import EtiquetaCategoria from './EtiquetaCategoria';
import RangoFechas from './RangoFechas';
import { descargarReporteCuentaPDF } from './reporte-wallet-pdf';
import { etiquetaMoneda, filtrarFilasPorCorrelativo, mensajeRango, textoTipoFila, totalesDeFilas } from './reporte-wallet-datos';

const CAMPO = 'w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';
const TH = 'px-3 py-2 text-left text-xs font-semibold text-text-secondary';
const TD = 'px-3 py-2 align-top text-sm';

/** Reporte de los movimientos de una cuenta o caja en un rango de fechas. */
function ReporteCuentaPanel() {
  const [bancas, setBancas] = useState<Banca[]>([]);
  const [cargandoBancas, setCargandoBancas] = useState(true);
  const [bancaId, setBancaId] = useState('');
  const [rango, setRango] = useState(() => rangoDeAtajo('mes', hoyLocal()));
  const [reporte, setReporte] = useState<ReporteCuenta | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buscar, setBuscar] = useState('');

  useEffect(() => { obtenerBancas({ incluirArchivadas: true }).then(setBancas).finally(() => setCargandoBancas(false)); }, []);
  const moneda = useMemo(() => etiquetaMoneda(reporte?.banca.moneda ?? ''), [reporte]);
  const conUsd = reporte?.banca.moneda === 'VES';
  // Con búsqueda activa, la tabla, sus totales y el PDF muestran solo los movimientos que coinciden.
  const vista = useMemo(() => {
    if (!reporte || buscar.trim() === '') return reporte;
    const filas = filtrarFilasPorCorrelativo(reporte.filas, buscar);
    return { ...reporte, filas, totales: totalesDeFilas(filas) };
  }, [reporte, buscar]);

  const generar = async () => {
    const falta = !bancaId ? 'Elige la cuenta o caja.' : mensajeRango(rango.desde, rango.hasta);
    if (falta) { setError(falta); return; }
    setError(null);
    setCargando(true);
    const r = await obtenerReporteCuenta(bancaId, rango.desde, rango.hasta);
    setCargando(false);
    if ('error' in r) { setError(r.error); setReporte(null); } else { setReporte(r); setBuscar(''); }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-3 sm:p-4">
        <div className="min-w-[14rem] flex-1">
          <label htmlFor="reporte-cuenta" className="block text-xs font-medium text-text-secondary mb-1">Cuenta o caja</label>
          <select id="reporte-cuenta" value={bancaId} onChange={e => setBancaId(e.target.value)} disabled={cargandoBancas} aria-busy={cargandoBancas} className={`${CAMPO} disabled:opacity-60`}>
            <option value="">{cargandoBancas ? 'Cargando cuentas…' : '— Elige una cuenta o caja —'}</option>
            {bancas.map(b => <option key={b.id} value={b.id}>{b.nombre} ({etiquetaMoneda(b.moneda)}){b.archivada ? ' · archivada' : ''}</option>)}
          </select>
        </div>
        <RangoFechas desde={rango.desde} hasta={rango.hasta} onCambiar={setRango} />
        <button type="button" onClick={generar} disabled={cargando} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {cargando ? 'Generando…' : 'Generar reporte'}
        </button>
      </div>
      {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>}
      {reporte && vista && (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-text-secondary">
              {reporte.banca.nombre} · del {formatearFecha(reporte.desde)} al {formatearFecha(reporte.hasta)} · {vista.filas.length} {vista.filas.length === 1 ? 'movimiento' : 'movimientos'}
              {vista.filas.length !== reporte.filas.length ? ` de ${reporte.filas.length}` : ''}
            </p>
            <AccionesReporte generar={modo => descargarReporteCuentaPDF(vista, modo, buscar)} exportarExcel={() => import('./reporte-wallet-xlsx').then(m => m.descargarReporteCuentaXlsx(vista, buscar))} />
          </div>
          <div className="mb-3 max-w-xs">
            <label htmlFor="reporte-buscar-correlativo" className="block text-xs font-medium text-text-secondary mb-1">Buscar por N° (ej. MV-0012)</label>
            <input id="reporte-buscar-correlativo" type="search" value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="MV-0001, PG-0003…" className={CAMPO} />
          </div>
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="min-w-full divide-y divide-border">
              <thead><tr>
                <th className={TH}>Fecha</th><th className={TH}>N°</th><th className={TH}>Tipo</th><th className={TH}>Descripción</th><th className={TH}>Categoría</th>
                <th className={`${TH} text-right`}>Entra ({moneda})</th><th className={`${TH} text-right`}>Sale ({moneda})</th>
                {conUsd && <th className={`${TH} text-right`}>Equiv. USD</th>}
              </tr></thead>
              <tbody className="divide-y divide-border">
                {vista.filas.map(f => (
                  <tr key={f.id} className={f.anulado ? 'text-text-muted line-through' : ''}>
                    <td className={`${TD} whitespace-nowrap`}>{formatearFecha(f.fecha)}</td>
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>{numeroMovimiento(f)}</td>
                    <td className={TD}>{textoTipoFila(f)}{f.enProceso ? ' (en proceso)' : ''}</td>
                    <td className={TD}>{f.descripcion || '—'}{f.cuentaContraria ? <span className="text-text-muted"> · Con: {f.cuentaContraria}</span> : null}</td>
                    <td className={TD}>{f.categoria ? <EtiquetaCategoria nombre={f.categoria.nombre} color={f.categoria.color} /> : <span className="text-text-muted">Sin categoría</span>}</td>
                    <td className={`${TD} text-right tabular-nums`}>{f.entrada ? formatearNumero(f.entrada, 2) : ''}</td>
                    <td className={`${TD} text-right tabular-nums`}>{f.salida ? formatearNumero(f.salida, 2) : ''}</td>
                    {conUsd && <td className={`${TD} text-right tabular-nums`}>{f.equivalenteUsd != null ? formatearNumero(f.equivalenteUsd, 2) : ''}</td>}
                  </tr>
                ))}
                {vista.filas.length === 0 && <tr><td colSpan={conUsd ? 8 : 7} className="px-3 py-6 text-center text-sm text-text-muted">{reporte.filas.length === 0 ? 'No hay movimientos de esta cuenta en el periodo.' : 'Ningún movimiento coincide con esa búsqueda.'}</td></tr>}
              </tbody>
              <tfoot className="bg-surface-alt text-sm font-semibold">
                <tr><td colSpan={5} className="px-3 py-2 text-right">{buscar.trim() ? 'Total que entra / sale (solo filas filtradas)' : 'Total que entra / sale'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatearNumero(vista.totales.entradas, 2)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatearNumero(vista.totales.salidas, 2)}</td>{conUsd && <td />}</tr>
                <tr><td colSpan={5} className="px-3 py-2 text-right">{buscar.trim() ? 'Neto de las filas filtradas' : 'Neto del periodo'} ({moneda})</td>
                  <td colSpan={conUsd ? 3 : 2} className="px-3 py-2 text-right tabular-nums">{formatearNumero(vista.totales.neto, 2)}</td></tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default ReporteCuentaPanel;
