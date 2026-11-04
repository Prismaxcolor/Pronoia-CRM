import type { ReporteCuenta } from '@shared/types/index.js';
import { formatearNumero } from '../../../components/ui';
import { formatearFecha } from '../../../lib/formato';
import { numeroMovimiento } from '../detalle-movimiento';
import EtiquetaCategoria from './EtiquetaCategoria';
import { etiquetaMoneda, textoTipoFila } from './reporte-wallet-datos';

const TH = 'px-3 py-2 text-left text-xs font-semibold text-text-secondary';
const TD = 'px-3 py-2 align-top text-sm';

interface Props {
  /** Reporte tal como se muestra (ya filtrado por la búsqueda, si la hay). */
  reporte: ReporteCuenta;
  /** Cuántos movimientos tiene el reporte sin filtrar. */
  totalSinFiltrar: number;
  filtrado: boolean;
}

/** Tabla de los movimientos de UNA cuenta, con sus totales en la moneda de esa cuenta. */
function TablaReporteCuenta({ reporte, totalSinFiltrar, filtrado }: Props) {
  const moneda = etiquetaMoneda(reporte.banca.moneda);
  const conUsd = reporte.banca.moneda === 'VES';
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="min-w-full divide-y divide-border">
        <thead><tr>
          <th className={TH}>Fecha</th><th className={TH}>N°</th><th className={TH}>Tipo</th><th className={TH}>Descripción</th><th className={TH}>Categoría</th>
          <th className={`${TH} text-right`}>Entra ({moneda})</th><th className={`${TH} text-right`}>Sale ({moneda})</th><th className={`${TH} text-right`}>Saldo ({moneda})</th>
          {conUsd && <th className={`${TH} text-right`} title="Equivalente en USD a la tasa Binance del momento en que se hizo el movimiento (o la del pago, si se guardó)">Equiv. USD</th>}
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
              <td className={`${TD} text-right tabular-nums font-medium`}>{f.saldo != null ? formatearNumero(f.saldo, 2) : ''}</td>
              {conUsd && <td className={`${TD} text-right tabular-nums`}>{f.equivalenteUsd != null ? formatearNumero(f.equivalenteUsd, 2) : ''}</td>}
            </tr>
          ))}
          {reporte.filas.length === 0 && <tr><td colSpan={conUsd ? 9 : 8} className="px-3 py-6 text-center text-sm text-text-muted">{totalSinFiltrar === 0 ? 'No hay movimientos de esta cuenta en el periodo.' : 'Ningún movimiento coincide con esa búsqueda.'}</td></tr>}
        </tbody>
        <tfoot className="bg-surface-alt text-sm font-semibold">
          <tr><td colSpan={5} className="px-3 py-2 text-right">{filtrado ? 'Total que entra / sale (solo filas filtradas)' : 'Total que entra / sale'}</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatearNumero(reporte.totales.entradas, 2)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatearNumero(reporte.totales.salidas, 2)}</td><td />{conUsd && <td />}</tr>
          <tr><td colSpan={5} className="px-3 py-2 text-right">{filtrado ? 'Neto de las filas filtradas' : 'Neto del periodo'} ({moneda})</td>
            <td colSpan={conUsd ? 4 : 3} className="px-3 py-2 text-right tabular-nums">{formatearNumero(reporte.totales.neto, 2)}</td></tr>
        </tfoot>
      </table>
    </div>
  );
}

export default TablaReporteCuenta;
