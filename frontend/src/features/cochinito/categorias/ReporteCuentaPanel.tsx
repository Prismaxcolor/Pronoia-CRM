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
import { etiquetaMoneda, mensajeRango, textoTipoFila } from './reporte-wallet-datos';

const CAMPO = 'w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';
const TH = 'px-3 py-2 text-left text-xs font-semibold text-text-secondary';
const TD = 'px-3 py-2 align-top text-sm';

/** Reporte de los movimientos de una cuenta o caja en un rango de fechas. */
function ReporteCuentaPanel() {
  const [bancas, setBancas] = useState<Banca[]>([]);
  const [bancaId, setBancaId] = useState('');
  const [rango, setRango] = useState(() => rangoDeAtajo('mes', hoyLocal()));
  const [reporte, setReporte] = useState<ReporteCuenta | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { obtenerBancas({ incluirArchivadas: true }).then(setBancas); }, []);
  const moneda = useMemo(() => etiquetaMoneda(reporte?.banca.moneda ?? ''), [reporte]);

  const generar = async () => {
    const falta = !bancaId ? 'Elige la cuenta o caja.' : mensajeRango(rango.desde, rango.hasta);
    if (falta) { setError(falta); return; }
    setError(null);
    setCargando(true);
    const r = await obtenerReporteCuenta(bancaId, rango.desde, rango.hasta);
    setCargando(false);
    if ('error' in r) { setError(r.error); setReporte(null); } else setReporte(r);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-3 sm:p-4">
        <div className="min-w-[14rem] flex-1">
          <label htmlFor="reporte-cuenta" className="block text-xs font-medium text-text-secondary mb-1">Cuenta o caja</label>
          <select id="reporte-cuenta" value={bancaId} onChange={e => setBancaId(e.target.value)} className={CAMPO}>
            <option value="">— Elige una cuenta o caja —</option>
            {bancas.map(b => <option key={b.id} value={b.id}>{b.nombre} ({etiquetaMoneda(b.moneda)}){b.archivada ? ' · archivada' : ''}</option>)}
          </select>
        </div>
        <RangoFechas desde={rango.desde} hasta={rango.hasta} onCambiar={setRango} />
        <button type="button" onClick={generar} disabled={cargando} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {cargando ? 'Generando…' : 'Generar reporte'}
        </button>
      </div>
      {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>}
      {reporte && (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-text-secondary">
              {reporte.banca.nombre} · del {formatearFecha(reporte.desde)} al {formatearFecha(reporte.hasta)} · {reporte.filas.length} {reporte.filas.length === 1 ? 'movimiento' : 'movimientos'}
            </p>
            <AccionesReporte generar={modo => descargarReporteCuentaPDF(reporte, modo)} />
          </div>
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="min-w-full divide-y divide-border">
              <thead><tr>
                <th className={TH}>Fecha</th><th className={TH}>N°</th><th className={TH}>Tipo</th><th className={TH}>Descripción</th><th className={TH}>Categoría</th>
                <th className={`${TH} text-right`}>Entra ({moneda})</th><th className={`${TH} text-right`}>Sale ({moneda})</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {reporte.filas.map(f => (
                  <tr key={f.id} className={f.anulado ? 'text-text-muted line-through' : ''}>
                    <td className={`${TD} whitespace-nowrap`}>{formatearFecha(f.fecha)}</td>
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>{numeroMovimiento(f)}</td>
                    <td className={TD}>{textoTipoFila(f)}{f.enProceso ? ' (en proceso)' : ''}</td>
                    <td className={TD}>{f.descripcion || '—'}{f.cuentaContraria ? <span className="text-text-muted"> · Con: {f.cuentaContraria}</span> : null}</td>
                    <td className={TD}>{f.categoria ? <EtiquetaCategoria nombre={f.categoria.nombre} color={f.categoria.color} /> : <span className="text-text-muted">Sin categoría</span>}</td>
                    <td className={`${TD} text-right tabular-nums`}>{f.entrada ? formatearNumero(f.entrada, 2) : ''}</td>
                    <td className={`${TD} text-right tabular-nums`}>{f.salida ? formatearNumero(f.salida, 2) : ''}</td>
                  </tr>
                ))}
                {reporte.filas.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-text-muted">No hay movimientos de esta cuenta en el periodo.</td></tr>}
              </tbody>
              <tfoot className="bg-surface-alt text-sm font-semibold">
                <tr><td colSpan={5} className="px-3 py-2 text-right">Total que entra / sale</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatearNumero(reporte.totales.entradas, 2)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatearNumero(reporte.totales.salidas, 2)}</td></tr>
                <tr><td colSpan={5} className="px-3 py-2 text-right">Neto del periodo ({moneda})</td>
                  <td colSpan={2} className="px-3 py-2 text-right tabular-nums">{formatearNumero(reporte.totales.neto, 2)}</td></tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default ReporteCuentaPanel;
