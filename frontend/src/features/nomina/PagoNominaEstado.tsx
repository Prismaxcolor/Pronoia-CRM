import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import type { Nomina } from '../../../../shared/types/nomina.js';
import { estadoPagoNomina, lineaDePago, modoPagoNomina, textoPagada } from './nomina-pago';

/**
 * Estado del pago desde el Wallet de una nómina cerrada: "Pagada desde X el fecha" con un enlace al egreso de cada
 * moneda, o el aviso de que el pago se anuló junto con la nómina. No muestra nada si aún no se pagó.
 */
function PagoNominaEstado({ nomina }: { nomina: Pick<Nomina, 'pagos'> }) {
  const estado = estadoPagoNomina(nomina.pagos);
  if (estado === 'sin-pagar') return null;
  const anulado = estado === 'pago-anulado';
  // Pago trabajador por trabajador: el detalle (y los comprobantes) se ve en el panel de cada trabajador.
  if (!anulado && modoPagoNomina(nomina.pagos) === 'por-trabajador') return null;
  return (
    <section
      aria-label="Pago desde el Wallet"
      className={`mb-4 rounded-xl border p-3 text-sm ${anulado ? 'border-border bg-surface-alt text-text-secondary' : 'border-green-200 bg-green-50 text-green-900'}`}
    >
      <p className="flex items-center gap-1.5 font-medium">
        {!anulado && <CheckCircle2 size={16} aria-hidden="true" />}
        {anulado ? 'El pago desde el Wallet se anuló junto con la nómina (el dinero volvió a las cuentas).' : textoPagada(nomina.pagos)}
      </p>
      <ul className="mt-2 space-y-1">
        {nomina.pagos.map(p => (
          <li key={p.id} className={p.anulado ? 'line-through' : ''}>
            {lineaDePago(p)}{p.referencia ? ` · Ref. ${p.referencia}` : ''}
            {' '}
            <Link to={`/cochinito/movimientos/${p.movimientoId}`} className="underline">Ver movimiento</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default PagoNominaEstado;
