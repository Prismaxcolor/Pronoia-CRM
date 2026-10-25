import ComisionBancariaCampo, { AvisoComisionNoVerificada } from '../cochinito/ComisionBancariaCampo';
import { bloqueoPorComision, planDeComision, type EstadoComision, type OpcionComision } from '../cochinito/comision-formulario';
import type { EstadoTasasUsd } from '../cochinito/equivalente-usd';
import { formatearNumero } from '../../lib/formato';
import {
  FUENTES_TASA_PAGO, montoBsDePago, resumenPagoBs, tasaDePago, type FuenteTasaPago,
} from './pago-bs-tasa';

interface Props {
  /** Identifica el grupo de opciones de la comisión (hay una línea por cuenta). */
  idLinea: number;
  /** Lo que se paga desde esta cuenta, en USD (es lo que se aplica a la factura). */
  montoUsd: number;
  fuente: FuenteTasaPago;
  tasaManual: string;
  /** Tasas Binance y BCV ya cargadas por el modal (las mismas que usa el Wallet). */
  tasasUsd: EstadoTasasUsd;
  comisionOpcion: OpcionComision;
  comisionEstado: EstadoComision;
  onFuente: (fuente: FuenteTasaPago) => void;
  onTasaManual: (valor: string) => void;
  onComision: (opcion: OpcionComision) => void;
  onReintentarComision: () => void;
}

const inputClass = 'w-28 px-2 py-1.5 bg-surface border border-border rounded-lg text-xs text-right focus:outline-none focus:ring-2 focus:ring-brand-400';

/** Etiqueta del botón de tasa: "Binance · Bs 600,00" (o solo el nombre si aún no hay valor). */
function etiquetaTasa(fuente: FuenteTasaPago, base: string, tasasUsd: EstadoTasasUsd): string {
  if (fuente === 'manual') return base;
  const t = tasasUsd.tasas[fuente];
  return t ? `${base} · Bs ${formatearNumero(t.tasa, 2)}` : `${base} · sin tasa`;
}

/**
 * Bloque de una cuenta en Bs en el pago a proveedor: la tasa con la que se calculan los bolívares (Binance, BCV o
 * manual), el equivalente USD/Bs y la pregunta de comisión bancaria del Wallet (mismo campo, misma regla).
 */
function LineaPagoBs({
  idLinea, montoUsd, fuente, tasaManual, tasasUsd, comisionOpcion, comisionEstado,
  onFuente, onTasaManual, onComision, onReintentarComision,
}: Props) {
  const tasa = tasaDePago(fuente, tasasUsd.tasas, tasaManual);
  const montoBs = montoBsDePago(montoUsd, tasa);
  const resumen = tasasUsd.cargando && fuente !== 'manual' ? 'Cargando las tasas…' : resumenPagoBs(montoUsd, fuente, tasa);
  const ofreceComision = comisionEstado === 'disponible';
  // Un pago a proveedor puede dejar la cuenta en negativo (regla vigente): el saldo no limita la comisión.
  const plan = planDeComision({
    ofrecida: ofreceComision, tipo: 'egreso', moneda: 'VES', monto: montoBs ?? 0, opcion: comisionOpcion, saldo: Number.POSITIVE_INFINITY,
  });
  const bloqueo = bloqueoPorComision({ estado: comisionEstado, tipo: 'egreso', moneda: 'VES', mesaActiva: false });

  return (
    <div className="space-y-3 rounded-lg bg-surface-alt p-2.5">
      <div className="space-y-2">
        <p className="text-xs font-medium text-text-secondary">Tasa para calcular los bolívares</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-border text-xs font-medium" role="group" aria-label="Tasa de cambio">
            {FUENTES_TASA_PAGO.map(f => (
              <button
                key={f.valor}
                type="button"
                aria-pressed={fuente === f.valor}
                onClick={() => onFuente(f.valor)}
                className={`px-3 py-1.5 ${fuente === f.valor ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary hover:bg-surface-hover'}`}
              >
                {etiquetaTasa(f.valor, f.etiqueta, tasasUsd)}
              </button>
            ))}
          </div>
          {fuente === 'manual' && (
            <input
              type="text" inputMode="decimal"
              value={tasaManual}
              onChange={e => onTasaManual(e.target.value)}
              className={inputClass}
              placeholder="Bs por USD"
              aria-label="Tasa manual (Bs por USD)"
            />
          )}
        </div>
        {resumen && <p className={`text-xs ${tasa === null && !tasasUsd.cargando ? 'text-amber-800' : 'text-text-secondary'}`} aria-live="polite">{resumen}</p>}
      </div>

      {ofreceComision && (
        <ComisionBancariaCampo nombre={`lleva-comision-pago-${idLinea}`} opcion={comisionOpcion} onCambiar={onComision} plan={plan} monto={montoBs ?? 0} />
      )}
      {bloqueo && <AvisoComisionNoVerificada mensaje={bloqueo} enError={comisionEstado === 'error'} onReintentar={onReintentarComision} />}
    </div>
  );
}

export default LineaPagoBs;
