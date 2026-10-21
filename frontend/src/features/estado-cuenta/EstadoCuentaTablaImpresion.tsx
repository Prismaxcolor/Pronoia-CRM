import type { EntradaEstadoCuenta } from '../../services/estado-cuenta-service';
import { totalesEstadoCuenta } from '@shared/types/estado-cuenta-totales.js';
import { LABEL_POR_TIPO, fmt } from './estado-cuenta-comun';
import { paginarImpresion } from './paginar-impresion';

interface Props {
  entradas: readonly EntradaEstadoCuenta[];
  /** Saldo acumulado de la cuenta tras la última fila (distinto de cargos - abonos si se filtró por tipo). */
  saldoFinal: number;
  filtradoPorTipo: boolean;
  /** Saldo real de hoy de toda la cuenta; solo se pasa cuando se consultó un rango de fechas (null = sin rango). */
  saldoActual: number | null;
}

function FilaImpresion({ e }: { e: EntradaEstadoCuenta }) {
  return (
    <tr className={`border-b border-border last:border-b-0 ${e.anulada ? 'opacity-50' : ''}`}>
      <td className="px-5 py-3 text-text-secondary whitespace-nowrap">{e.fecha}</td>
      <td className="px-5 py-3 text-text-primary">
        <span className="mr-2 inline-block rounded-full border border-black px-2 py-0.5 text-xs">{LABEL_POR_TIPO[e.tipo]}</span>
        <span className={e.anulada ? 'line-through' : ''}>{e.descripcion}</span>
        {e.anulada && <span className="ml-2 text-xs font-medium">Anulada</span>}
        {e.pagada && !e.anulada && <span className="ml-2 text-xs text-text-muted">(pagada)</span>}
        {e.facturaAsociadaCodigo && <span className="mt-0.5 block text-xs text-text-muted">→ {e.facturaAsociadaCodigo}</span>}
        {e.categoria && <span className="mt-0.5 block text-xs text-text-muted">Categoría: {e.categoria.nombre}</span>}
        {e.tipo === 'cruce' && (
          <span className="mt-0.5 block text-xs text-text-muted">Saldó ${fmt(e.montoCruzado ?? 0)} en facturas sin mover dinero (el saldo no cambia)</span>
        )}
        {e.tipo === 'adelanto' && e.adelantoAplicado != null && e.adelantoAplicado > 0 && (
          <span className="mt-0.5 block text-xs text-text-muted">Aplicado ${fmt(e.adelantoAplicado)} a facturas · disponible ${fmt(e.adelantoDisponible ?? 0)}</span>
        )}
      </td>
      <td className="px-5 py-3 text-text-muted">
        {e.referencia ?? '—'}
        {e.referenciaExterna && <span className="block text-xs text-text-muted">{e.referenciaExterna}</span>}
      </td>
      <td className="px-5 py-3 text-right text-text-primary">
        {e.anulada && e.tipo === 'nota_debito' && e.montoAnulado
          ? <span className="line-through text-text-muted">{fmt(e.montoAnulado)}</span>
          : (e.cargo ? fmt(e.cargo) : '—')}
      </td>
      <td className="px-5 py-3 text-right text-text-primary">
        {e.anulada && e.tipo === 'nota_credito' && e.montoAnulado
          ? <span className="line-through text-text-muted">{fmt(e.montoAnulado)}</span>
          : (e.abono ? fmt(e.abono) : '—')}
      </td>
    </tr>
  );
}

function PaginaImpresion({ filas, esUltima, vacia }: { filas: readonly EntradaEstadoCuenta[]; esUltima: boolean; vacia: boolean }) {
  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-border bg-surface" style={esUltima ? undefined : { breakAfter: 'page' }}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-text-muted">
            <th className="px-5 py-3 font-medium">Fecha</th>
            <th className="px-5 py-3 font-medium">Concepto</th>
            <th className="px-5 py-3 font-medium">Referencia</th>
            <th className="px-5 py-3 font-medium text-right">Cargo</th>
            <th className="px-5 py-3 font-medium text-right">Abono</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((e, i) => <FilaImpresion key={i} e={e} />)}
        </tbody>
      </table>
      {vacia && <p className="py-12 text-center text-sm text-text-muted">Sin movimientos en este período.</p>}
    </div>
  );
}

function TotalesImpresion({ entradas, saldoFinal, filtradoPorTipo, saldoActual }: Props) {
  const totales = totalesEstadoCuenta(entradas);
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex w-full max-w-xs justify-between text-sm">
        <span className="text-text-secondary">Total cargos</span>
        <span className="font-medium text-text-primary">{fmt(totales.totalCargos)}</span>
      </div>
      <div className="flex w-full max-w-xs justify-between text-sm">
        <span className="text-text-secondary">Total abonos</span>
        <span className="font-medium text-text-primary">{fmt(totales.totalAbonos)}</span>
      </div>
      <div className="flex w-full max-w-xs justify-between border-t border-border pt-2 text-base">
        <span className="font-semibold text-text-primary">{saldoActual != null ? 'Saldo del periodo' : 'Saldo final'}</span>
        <span className="font-bold text-text-primary">{fmt(saldoFinal)}</span>
      </div>
      {saldoActual != null && (
        <div className="flex w-full max-w-xs justify-between border-t border-border pt-2 text-base">
          <span className="font-semibold text-text-primary">Saldo actual (hoy)</span>
          <span className="font-bold text-text-primary">{fmt(saldoActual)}</span>
        </div>
      )}
      <p className="max-w-xs text-right text-xs text-text-muted">
        {filtradoPorTipo ? `Cargos y abonos de las ${totales.filas} filas filtradas; el saldo final es el de toda la cuenta.` : `Totales de las ${totales.filas} filas mostradas, en USD.`}
      </p>
    </div>
  );
}

/** Versión IMPRESA del estado de cuenta: la tabla clásica (fecha, concepto, referencia, cargo, abono) y los totales.
 *  Máximo MOVIMIENTOS_POR_PAGINA_IMPRESION filas por página (cada trozo en su tabla, con el encabezado repetido); los
 *  totales y saldos van en la última. Solo se ve al imprimir; se mantiene aparte de la tabla interactiva. */
function EstadoCuentaTablaImpresion(props: Props) {
  const paginas = paginarImpresion(props.entradas);
  return (
    <div className="hidden print:block">
      {paginas.map((filas, i) => (
        <PaginaImpresion key={i} filas={filas} esUltima={i === paginas.length - 1} vacia={props.entradas.length === 0} />
      ))}
      <TotalesImpresion {...props} />
    </div>
  );
}

export default EstadoCuentaTablaImpresion;
