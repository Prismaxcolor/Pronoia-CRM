import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

/** Piezas de PRESENTACIÓN del formulario de nueva factura (no contienen lógica de totales, precios ni selección:
 *  todo llega ya calculado desde FacturaFormPage). */

interface PasoProps {
  numero: number;
  titulo: string;
  /** Una línea que explica qué se hace en este paso. */
  ayuda: string;
  children: ReactNode;
}

/** Un paso del formulario: tarjeta con número, título y una línea de ayuda. */
export function FacturaPaso({ numero, titulo, ayuda, children }: PasoProps) {
  return (
    <section aria-label={`Paso ${numero}: ${titulo}`} className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <header className="mb-4 flex items-start gap-3">
        <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">{numero}</span>
        <div>
          <h2 className="text-base font-semibold text-text-primary">{titulo}</h2>
          <p className="text-xs text-text-secondary">{ayuda}</p>
        </div>
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

interface ResumenProps {
  /** Total ya formateado (con o sin signo de moneda, según el tipo de factura). */
  total: string;
  kgFacturables: string;
  tickets: number;
  materiales: number;
  error: string | null;
  guardando: boolean;
  onCancelar: () => void;
}

/** Resumen fijo: a la derecha en escritorio y pegado al borde inferior en móvil. Contiene los botones de enviar y cancelar. */
export function FacturaResumen({ total, kgFacturables, tickets, materiales, error, guardando, onCancelar }: ResumenProps) {
  return (
    <aside
      aria-label="Resumen de la factura"
      className="rounded-xl border border-brand-200 bg-brand-50 p-4 shadow-sm max-lg:sticky max-lg:bottom-2 max-lg:z-10 max-lg:shadow-lg lg:sticky lg:top-4"
    >
      <p className="text-xs font-medium text-brand-700">Total de la factura</p>
      <p className="text-2xl font-bold tabular-nums text-brand-700">{total}</p>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs lg:grid-cols-1 lg:gap-1.5">
        <div className="lg:flex lg:justify-between"><dt className="text-text-secondary">Tickets</dt><dd className="font-medium tabular-nums text-text-primary">{tickets}</dd></div>
        <div className="lg:flex lg:justify-between"><dt className="text-text-secondary">Materiales</dt><dd className="font-medium tabular-nums text-text-primary">{materiales}</dd></div>
        <div className="lg:flex lg:justify-between"><dt className="text-text-secondary">Kg facturables</dt><dd className="font-medium tabular-nums text-text-primary">{kgFacturables}</dd></div>
      </dl>

      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}

      <div className="mt-3 flex gap-3">
        <button type="button" onClick={onCancelar} className="flex-1 rounded-lg border border-border bg-surface py-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
          Cancelar
        </button>
        <button type="submit" disabled={guardando} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50">
          {guardando ? <><Loader2 size={16} className="animate-spin" /> Emitiendo...</> : 'Emitir factura'}
        </button>
      </div>
    </aside>
  );
}
