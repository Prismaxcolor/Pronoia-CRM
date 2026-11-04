import { Link } from 'react-router-dom';
import { Wallet } from 'lucide-react';
import { BotonAccion, Insignia } from '../../components/ui';
import { formatearNumero } from '../../lib/formato';
import type { LineaNomina, Nomina, PagoNomina } from '../../../../shared/types/nomina.js';
import {
  ETIQUETA_ESTADO_PAGO_TRABAJADOR, estadoPagoTrabajador, gruposDePagoLinea, lineaDePago, modoPagoNomina, pagosDeTrabajador,
  resumenPagoTrabajadores, sePuedePagarTrabajador, type EstadoPagoTrabajador, type GrupoPago,
} from './nomina-pago';

interface Props {
  nomina: Nomina;
  /** La persona puede pagar desde el Wallet (nomina.editar + cochinito.crear). */
  puedePagar: boolean;
  onPagar: (linea: LineaNomina) => void;
}

const TONO: Record<EstadoPagoTrabajador, 'exito' | 'aviso' | 'neutral'> = {
  pendiente: 'aviso', pagado: 'exito', anulado: 'neutral', 'sin-monto': 'neutral',
};

function Montos({ grupos }: { grupos: readonly GrupoPago[] }) {
  if (grupos.length === 0) return <span className="text-text-muted">—</span>;
  return (
    <>
      {grupos.map(g => (
        <p key={g.moneda} className="tabular-nums">
          {g.moneda === 'USD' ? 'USD' : 'Bs'} {formatearNumero(g.monto, 2)}
          {g.moneda === 'BS' && <span className="ml-1 text-xs text-text-secondary">≈ USD {formatearNumero(g.montoUsd, 2)}</span>}
        </p>
      ))}
    </>
  );
}

function DetallePagos({ pagos }: { pagos: readonly PagoNomina[] }) {
  if (pagos.length === 0) return null;
  return (
    <ul className="space-y-1 text-xs text-text-secondary">
      {pagos.map(p => (
        <li key={p.id} className={p.anulado ? 'line-through' : ''}>
          {lineaDePago(p)}{p.referencia ? ` · Ref. ${p.referencia}` : ''}{' '}
          <Link to={`/cochinito/movimientos/${p.movimientoId}`} className="underline">Ver movimiento</Link>
          {p.comprobantes.map((url, i) => (
            <span key={url}>
              {' · '}
              <a href={url} target="_blank" rel="noopener noreferrer" className="underline">Comprobante{p.comprobantes.length > 1 ? ` ${i + 1}` : ''}</a>
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}

/**
 * Pago trabajador por trabajador de una nómina cerrada: cada renglón con lo que se le debe, su estado (pagado / pendiente),
 * el pago con su comprobante y el botón «Pagar» que abre el pago desde el Wallet.
 */
function PagoTrabajadoresPanel({ nomina, puedePagar, onPagar }: Props) {
  const { pagados, total } = resumenPagoTrabajadores(nomina);
  const completa = modoPagoNomina(nomina.pagos) === 'completa';
  return (
    <section aria-label="Pago por trabajador" className="mb-6 rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border p-3">
        <h3 className="text-sm font-semibold text-text-primary">Pago por trabajador</h3>
        <p className="text-sm text-text-secondary" role="status">Pagados {pagados} de {total}</p>
      </div>
      {completa && (
        <p className="border-b border-border p-3 text-xs text-text-secondary">La nómina se pagó completa desde el Wallet: todos los trabajadores figuran como pagados.</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <caption className="sr-only">Estado de pago de cada trabajador de la nómina</caption>
          <thead className="bg-surface-alt text-xs text-text-secondary">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">Trabajador</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">A pagar</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Estado</th>
              <th scope="col" className="px-3 py-2 text-right font-medium"><span className="sr-only">Acción</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {nomina.lineas.map(l => {
              const estado = estadoPagoTrabajador(nomina, l);
              return (
                <tr key={l.trabajadorId} className="align-top">
                  <th scope="row" className="px-3 py-2 text-left font-medium text-text-primary">{l.trabajadorNombre}</th>
                  <td className="px-3 py-2 text-right"><Montos grupos={gruposDePagoLinea(l)} /></td>
                  <td className="px-3 py-2">
                    <Insignia tono={TONO[estado]}>{ETIQUETA_ESTADO_PAGO_TRABAJADOR[estado]}</Insignia>
                    {!completa && <div className="mt-1"><DetallePagos pagos={pagosDeTrabajador(nomina.pagos, l.trabajadorId)} /></div>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {puedePagar && sePuedePagarTrabajador(nomina, l) && (
                      <BotonAccion icono={<Wallet size={16} />} onClick={() => onPagar(l)}>Pagar<span className="sr-only"> a {l.trabajadorNombre}</span></BotonAccion>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default PagoTrabajadoresPanel;
