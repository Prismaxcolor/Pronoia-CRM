import { Link } from 'react-router-dom';
import { Info, ListOrdered } from 'lucide-react';
import type { Banca } from '@shared/types/index.js';
import { TarjetaKpi } from '../../components/ui';
import type { EstadoTasasUsd } from '../cochinito/equivalente-usd';
import { totalesPorMoneda, rutaRegistros } from './wallet-cuentas-logica';
import { MONTO_OCULTO, formatearMonto, totalEnUsd } from './wallet-grupos';

const BOTON_SEL = 'inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';

function notaDeTasa(base: readonly Banca[], tasas: EstadoTasasUsd, omitidas: number): string | null {
  const hayBs = base.some(c => c.moneda === 'VES');
  if (tasas.cargando && hayBs) return 'Calculando el equivalente de las cuentas en Bs…';
  if (omitidas === 0) return null;
  const motivo = hayBs && !tasas.tasas.binance ? 'falta la tasa Binance' : 'su moneda no tiene conversión a USD';
  return `${omitidas} ${omitidas === 1 ? 'cuenta no suma' : 'cuentas no suman'}: ${motivo}.`;
}

interface ResumenProps {
  base: readonly Banca[];
  totalCuentas: number;
  cantidadSeleccionadas: number;
  tasas: EstadoTasasUsd;
  ocultar: boolean;
}

/** Saldo total: cada moneda en su propia unidad y, aparte, el equivalente total en USD con su aviso de tasa. */
export function ResumenSaldo({ base, totalCuentas, cantidadSeleccionadas, tasas, ocultar }: ResumenProps) {
  const total = totalEnUsd(base, tasas.tasas.binance?.tasa);
  const porMoneda = totalesPorMoneda(base);
  const nota = notaDeTasa(base, tasas, total.omitidas);
  const titulo = cantidadSeleccionadas > 0
    ? `Selección (${cantidadSeleccionadas} ${cantidadSeleccionadas === 1 ? 'cuenta' : 'cuentas'})`
    : `Saldo total · ${totalCuentas} cuentas`;
  return (
    <section aria-label="Saldo total" className="mb-5">
      <TarjetaKpi
        titulo={titulo}
        valor={ocultar ? MONTO_OCULTO : formatearMonto(total.totalUsd, 'USD')}
        unidad="USD equivalente"
        subtitulo="Las cuentas en Bs se convierten a la tasa Binance del momento; los montos por moneda no se mezclan."
      >
        {porMoneda.length > 0 && (
          <ul aria-label="Saldo por moneda" className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-3 text-sm tabular-nums">
            {porMoneda.map(t => (
              <li key={t.moneda}>
                <span className="text-text-secondary">{t.moneda === 'VES' ? 'Bs' : t.moneda}: </span>
                <span className="font-medium text-text-primary">{ocultar ? MONTO_OCULTO : formatearMonto(t.total, t.moneda)}</span>
              </li>
            ))}
          </ul>
        )}
        {nota && <p className="mt-2 text-xs text-text-secondary">{nota}</p>}
      </TarjetaKpi>
    </section>
  );
}

interface BarraProps {
  ids: readonly string[];
  total: number;
  onQuitar: () => void;
  onSeleccionarTodo: () => void;
  onDetalle: () => void;
}

/** Acciones sobre las cuentas elegidas: ver sus registros o abrir el detalle (solo con exactamente una). */
export function BarraSeleccion({ ids, total, onQuitar, onSeleccionarTodo, onDetalle }: BarraProps) {
  return (
    <div role="group" aria-label="Acciones de la selección" className="mb-3 flex flex-wrap items-center gap-2">
      <Link to={rutaRegistros(ids)} className={BOTON_SEL}>
        <ListOrdered size={16} aria-hidden="true" /> Registros
      </Link>
      <button
        type="button"
        onClick={onDetalle}
        disabled={ids.length !== 1}
        title={ids.length === 1 ? undefined : 'Elige exactamente una cuenta'}
        className={`${BOTON_SEL} disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <Info size={16} aria-hidden="true" /> Detalle de la cuenta
      </button>
      <span className="ml-auto flex gap-4 text-sm">
        {ids.length > 0 && <button type="button" onClick={onQuitar} className="text-w-acento underline">Quitar selección</button>}
        {ids.length < total && <button type="button" onClick={onSeleccionarTodo} className="text-w-acento underline">Seleccionar todo</button>}
      </span>
    </div>
  );
}
