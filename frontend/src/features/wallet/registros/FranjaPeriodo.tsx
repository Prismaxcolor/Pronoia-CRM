import { SlidersHorizontal } from 'lucide-react';
import { InfoTooltip } from '../../../components/ui';
import { MONTO_OCULTO, formatearMonto } from '../wallet-grupos';
import type { FlujoUsd } from './registros-patas';

export function TotalUsd({ flujo, oculto }: { flujo: FlujoUsd; oculto: boolean }) {
  return (
    <span className="whitespace-nowrap font-semibold tabular-nums">
      <span aria-hidden="true">∑ </span><span className="sr-only">Flujo neto: </span>
      {oculto ? MONTO_OCULTO : formatearMonto(flujo.netoUsd, 'USD')}
    </span>
  );
}

interface Props {
  titulo: string;
  flujo: FlujoUsd;
  /** Enmascara el ∑: "ocultar cantidades" o filtro de cuentas con todas las elegidas ocultas. */
  ocultarSuma: boolean;
  /** false = no se muestra ∑ (filtro de categoría que ya no existe: un total no sería de esa categoría). */
  mostrarSuma?: boolean;
  /** Hay cuentas elegidas: el ∑ incluye las transferencias que entran o salen de la selección. */
  conFiltroCuentas: boolean;
  avanzadosActivos: number;
  onAbrirFiltros: () => void;
}

const EXPLICACION_SIN_CUENTAS = 'Ingresos menos egresos del período, en USD. Las transferencias no se suman (el dinero solo cambia de cuenta; su comisión sí cuenta como egreso) y los anulados tampoco. Las cuentas con el ojo tachado ocultan el monto de sus filas pero sí entran en esta suma. Si filtras solo por cuentas con el ojo tachado, la suma también se oculta.';
const EXPLICACION_CON_CUENTAS = 'Ingresos menos egresos del período, en USD, de las cuentas elegidas. Incluye lo que entra o sale de esas cuentas por transferencias (si eliges origen y destino se compensan). Una transferencia de mesa pendiente de cobro aún no suma en el destino. Los anulados no se suman. Si todas las cuentas elegidas tienen el ojo tachado, la suma se oculta.';

/** Franja pegada bajo el encabezado: título del período, ∑ del período y acceso al diálogo de filtros.
 *  El contenedor del Layout (<main>) tiene padding (p-4, md:p-8) y un sticky respeta ese padding: por eso `-top` negativo
 *  igual al padding (la franja queda a ras del borde, sin dejar ver las filas por encima) y `-mx` para cubrir los costados.
 *  Fondo sólido (no translúcido): las filas que pasan por debajo no deben verse a través. */
function FranjaPeriodo({ titulo, flujo, ocultarSuma, mostrarSuma = true, conFiltroCuentas, avanzadosActivos, onAbrirFiltros }: Props) {
  return (
    <div className="sticky -top-4 z-10 -mx-4 mb-3 border-b border-w-borde bg-w-fondo px-4 py-2 md:-top-8 md:-mx-8 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-w-texto2">
        <h2 className="font-semibold tracking-wide">{titulo}</h2>
        <div className="flex items-center gap-3">
          {mostrarSuma && (
            <span className="flex items-center gap-1.5">
              <TotalUsd flujo={flujo} oculto={ocultarSuma} />
              <InfoTooltip etiqueta="Qué significa ∑ en Registros">{conFiltroCuentas ? EXPLICACION_CON_CUENTAS : EXPLICACION_SIN_CUENTAS}</InfoTooltip>
            </span>
          )}
          <button
            type="button"
            onClick={onAbrirFiltros}
            className="inline-flex items-center gap-1.5 rounded-lg border border-w-borde bg-w-tarjeta px-3 py-1.5 text-sm font-medium text-w-texto focus:outline-none focus-visible:ring-2 focus-visible:ring-w-acento"
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            Filtros{avanzadosActivos > 0 && <span className="rounded-full bg-w-acento px-1.5 text-xs text-w-sobre-acento">{avanzadosActivos}<span className="sr-only"> activos</span></span>}
          </button>
        </div>
      </div>
      {mostrarSuma && flujo.sinEquivalente > 0 && (
        <p className="mt-1 text-xs text-w-texto2">
          {flujo.sinEquivalente} {flujo.sinEquivalente === 1 ? 'movimiento sin equivalente en USD no está incluido' : 'movimientos sin equivalente en USD no están incluidos'} en la suma.
        </p>
      )}
    </div>
  );
}

export default FranjaPeriodo;
