import { useEffect, useMemo, useState } from 'react';
import type { Banca, ReporteCuenta } from '@shared/types/index.js';
import { formatearNumero } from '../../../components/ui';
import { obtenerBancas } from '../../../services/banca-service';
import { obtenerReporteCuenta } from '../../../services/categoria-wallet-service';
import { formatearFecha } from '../../../lib/formato';
import { hoyLocal, rangoDeAtajo } from '../../../lib/rango-fechas';
import AccionesReporte from './AccionesReporte';
import RangoFechas from './RangoFechas';
import SelectorCuentasReporte from './SelectorCuentasReporte';
import TablaReporteCuenta from './TablaReporteCuenta';
import { descargarReportesCuentasPDF } from './reporte-wallet-pdf';
import { ejecutarConLimite } from '../../../lib/concurrencia';
import {
  combinarReportesCuentas, etiquetaMoneda, mensajeRango, reporteFiltrado, separarResultadosCuentas, type FalloCuenta,
} from './reporte-wallet-datos';

/** Cuántos reportes de cuenta se piden a la vez (con muchas cuentas no se lanzan todos juntos). */
const PETICIONES_SIMULTANEAS = 4;

const CAMPO = 'w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';

/** Resumen de una línea de una cuenta del reporte (periodo, cantidad de movimientos y saldos). */
function ResumenCuenta({ reporte, total }: { reporte: ReporteCuenta; total: number }) {
  const moneda = etiquetaMoneda(reporte.banca.moneda);
  return (
    <p className="text-sm text-text-secondary">
      {reporte.banca.nombre} · del {formatearFecha(reporte.desde)} al {formatearFecha(reporte.hasta)} · {reporte.filas.length} {reporte.filas.length === 1 ? 'movimiento' : 'movimientos'}
      {reporte.filas.length !== total ? ` de ${total}` : ''}
      {reporte.saldoInicial != null && reporte.saldoFinal != null && <> · Saldo inicial {moneda} {formatearNumero(reporte.saldoInicial, 2)} · Saldo final {moneda} {formatearNumero(reporte.saldoFinal, 2)}</>}
    </p>
  );
}

/** Reporte de los movimientos de una, varias o todas las cuentas o cajas en un rango de fechas (una tabla por cuenta, cada una en su moneda). */
function ReporteCuentaPanel() {
  const [bancas, setBancas] = useState<Banca[]>([]);
  const [cargandoBancas, setCargandoBancas] = useState(true);
  const [bancaIds, setBancaIds] = useState<string[]>([]);
  const [rango, setRango] = useState(() => rangoDeAtajo('mes', hoyLocal()));
  const [reportes, setReportes] = useState<ReporteCuenta[]>([]);
  const [todas, setTodas] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallos, setFallos] = useState<FalloCuenta[]>([]);
  const [buscar, setBuscar] = useState('');

  useEffect(() => { obtenerBancas({ incluirArchivadas: true }).then(setBancas).finally(() => setCargandoBancas(false)); }, []);
  // Con búsqueda activa, las tablas, sus totales y el PDF muestran solo los movimientos que coinciden.
  const vistas = useMemo(() => reportes.map(r => reporteFiltrado(r, buscar)), [reportes, buscar]);

  /** Pide el reporte de cada cuenta (de a pocas a la vez) sin que el fallo de una tire las demás. */
  const pedir = async (ids: readonly string[]) => {
    const resultados = await ejecutarConLimite(
      ids.map(id => async () => obtenerReporteCuenta(id, rango.desde, rango.hasta)),
      PETICIONES_SIMULTANEAS,
    );
    return separarResultadosCuentas(ids, resultados.map(r => (r.status === 'fulfilled' ? r.value : { error: 'No se pudo generar el reporte de la cuenta.' })));
  };
  const nombreDe = (id: string): string => bancas.find(b => b.id === id)?.nombre ?? 'una cuenta';

  const generar = async () => {
    const falta = bancaIds.length === 0 ? 'Elige al menos una cuenta o caja.' : mensajeRango(rango.desde, rango.hasta);
    if (falta) { setError(falta); return; }
    setError(null);
    setCargando(true);
    // Se respeta el orden de la lista de cuentas, no el orden en que se marcaron.
    const ids = bancas.filter(b => bancaIds.includes(b.id)).map(b => b.id);
    const r = await pedir(ids);
    setCargando(false);
    setReportes(r.reportes);
    setFallos(r.fallos);
    setTodas(ids.length === bancas.length);
    setBuscar('');
    if (r.reportes.length === 0) setError(r.fallos[0]?.error ?? 'No se pudo generar el reporte.');
  };

  const reintentarFallidas = async () => {
    setCargando(true);
    const r = await pedir(fallos.map(f => f.bancaId));
    setCargando(false);
    setReportes(actuales => combinarReportesCuentas(actuales, r.reportes, bancas.map(b => b.id)));
    setFallos(r.fallos);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-3 sm:p-4">
        <SelectorCuentasReporte bancas={bancas} cargando={cargandoBancas} seleccion={bancaIds} onCambiar={setBancaIds} />
        <RangoFechas desde={rango.desde} hasta={rango.hasta} onCambiar={setRango} />
        <button type="button" onClick={generar} disabled={cargando} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {cargando ? 'Generando…' : 'Generar reporte'}
        </button>
      </div>
      {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>}
      {fallos.length > 0 && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <span>
            No se pudo cargar {fallos.length === 1 ? 'la cuenta' : 'las cuentas'}: {fallos.map(f => nombreDe(f.bancaId)).join(', ')}.
            {reportes.length > 0 ? ' El reporte de abajo no las incluye.' : ''}
          </span>
          <button type="button" onClick={reintentarFallidas} disabled={cargando} className="shrink-0 rounded-md border border-amber-400 px-3 py-1 text-xs font-medium hover:bg-amber-100 disabled:opacity-50">
            {cargando ? 'Reintentando…' : 'Reintentar'}
          </button>
        </div>
      )}
      {reportes.length > 0 && (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-text-secondary">
              {reportes.length === 1 ? 'Una cuenta' : todas ? 'Todas las cuentas' : `${reportes.length} cuentas`}: cada cuenta va en su propia tabla y en su moneda (no se suman Bs con USD).
            </p>
            <AccionesReporte
              generar={modo => descargarReportesCuentasPDF(vistas, modo, buscar, todas)}
              exportarExcel={() => import('./reporte-wallet-xlsx').then(m => m.descargarReportesCuentasXlsx(vistas, buscar, todas))}
            />
          </div>
          <div className="mb-3 max-w-xs">
            <label htmlFor="reporte-buscar-correlativo" className="block text-xs font-medium text-text-secondary mb-1">Buscar por N° (ej. MV-0012)</label>
            <input id="reporte-buscar-correlativo" type="search" value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="MV-0001, PG-0003…" className={CAMPO} />
          </div>
          <div className="space-y-6">
            {vistas.map((v, i) => (
              <section key={v.banca.id} aria-label={`Cuenta ${v.banca.nombre}`}>
                <div className="mb-2"><ResumenCuenta reporte={v} total={reportes[i].filas.length} /></div>
                <TablaReporteCuenta reporte={v} totalSinFiltrar={reportes[i].filas.length} filtrado={buscar.trim() !== ''} />
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default ReporteCuentaPanel;
