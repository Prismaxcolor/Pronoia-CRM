import { Eye, EyeOff } from 'lucide-react';
import type { Banca } from '@shared/types/index.js';
import IconoGrupo from './IconoGrupo';
import { colorCuenta } from './wallet-cuentas-logica';
import { MONTO_OCULTO, formatearMonto, grupoDeBanca } from './wallet-grupos';

interface Props {
  banca: Banca;
  seleccionada: boolean;
  /** Hay alguna cuenta seleccionada: las demás se atenúan. */
  hayAlgunaSeleccionada: boolean;
  /** Enmascarar todos los montos (preferencia global). */
  ocultarTodo: boolean;
  /** Enmascarar solo el monto de esta cuenta (su ojo). */
  ocultaEstaCuenta: boolean;
  onAlternarSeleccion: () => void;
  onAlternarOculta: () => void;
}

const BASE = 'flex w-full items-start gap-3 rounded-xl border bg-surface p-3 pr-9 text-left shadow-sm transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';
const ESTADO_SELECCION = {
  seleccionada: 'border-brand-500 ring-2 ring-brand-500',
  atenuada: 'border-border opacity-70',
  normal: 'border-border',
} as const;

/** Tarjeta de una cuenta en el Inicio: cuadrado de color con su ícono, nombre y saldo en texto del sistema; clic = seleccionar, ojo = ocultar su monto. */
function TileCuenta({ banca, seleccionada, hayAlgunaSeleccionada, ocultarTodo, ocultaEstaCuenta, onAlternarSeleccion, onAlternarOculta }: Props) {
  const claveGrupo = grupoDeBanca(banca);
  const color = colorCuenta(banca, claveGrupo);
  const estado = seleccionada ? 'seleccionada' : hayAlgunaSeleccionada ? 'atenuada' : 'normal';
  const enmascarar = ocultarTodo || ocultaEstaCuenta;
  const negativo = banca.saldo < 0 && !enmascarar;
  const monto = enmascarar ? MONTO_OCULTO : formatearMonto(banca.saldo, banca.moneda);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onAlternarSeleccion}
        aria-pressed={seleccionada}
        title={seleccionada ? 'Quitar de la selección' : 'Seleccionar esta cuenta'}
        className={`${BASE} ${ESTADO_SELECCION[estado]}`}
      >
        <IconoGrupo grupo={claveGrupo} imagenUrl={banca.imagenUrl} tamano={40} colorPropio={color} />
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-medium leading-snug text-text-primary line-clamp-2" title={banca.nombre}>{banca.nombre}</span>
          <span className={`mt-0.5 block truncate text-base font-bold tabular-nums ${negativo ? 'text-red-700' : 'text-text-primary'}`}>
            {monto}
            {negativo && <span className="sr-only"> (saldo negativo)</span>}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onAlternarOculta}
        aria-pressed={ocultaEstaCuenta}
        aria-label={ocultaEstaCuenta ? `Mostrar el monto de ${banca.nombre}` : `Ocultar el monto de ${banca.nombre}`}
        className="absolute right-1.5 top-1.5 rounded-full p-1.5 text-text-muted hover:bg-surface-hover hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        {ocultaEstaCuenta ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
      </button>
    </div>
  );
}

export default TileCuenta;
