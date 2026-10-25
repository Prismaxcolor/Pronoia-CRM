import { formatearNumero } from '../../components/ui';
import {
  MINIMO_COMISION_BANCARIA_BS, TASA_COMISION_BANCARIA, type PlanComisionBancaria,
} from '../../../../shared/types/comision-bancaria.js';
import { TEXTO_MESA_SIN_COMISION_BANCARIA, type OpcionComision } from './comision-formulario';

interface Props {
  opcion: OpcionComision;
  onCambiar: (opcion: OpcionComision) => void;
  plan: PlanComisionBancaria;
  monto: number;
  /** Nombre del grupo de opciones: debe ser distinto si hay varios campos en el mismo formulario (un pago con varias cuentas). */
  nombre?: string;
}

const PORCENTAJE = `${Math.round(TASA_COMISION_BANCARIA * 1000) / 10}%`;
const OPCIONES: ReadonlyArray<{ valor: Exclude<OpcionComision, ''>; etiqueta: string }> = [
  { valor: 'si', etiqueta: 'Sí' },
  { valor: 'no', etiqueta: 'No' },
];

/** Resumen: comisión y total que se debitará de la cuenta (solo con "Sí" y un monto válido). */
function Resumen({ plan, monto }: { plan: PlanComisionBancaria; monto: number }) {
  if (!(monto > 0) || !plan.ok || !plan.aplica || !plan.lleva) return null;
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs" aria-label="Resumen de la comisión bancaria">
      <dt className="text-text-secondary">Monto del movimiento</dt>
      <dd className="text-right font-medium tabular-nums">Bs {formatearNumero(monto, 2)}</dd>
      <dt className="text-text-secondary">Comisión bancaria ({PORCENTAJE}, mínimo Bs {MINIMO_COMISION_BANCARIA_BS})</dt>
      <dd className="text-right font-medium tabular-nums">Bs {formatearNumero(plan.comision, 2)}</dd>
      <dt className="font-medium text-text-primary">Total que se debita de la cuenta</dt>
      <dd className="text-right font-semibold tabular-nums text-text-primary">Bs {formatearNumero(plan.totalDebitado, 2)}</dd>
    </dl>
  );
}

/** Pregunta obligatoria "¿Lleva comisión bancaria?" para salidas desde una cuenta en Bs. Sin respuesta marcada de inicio. */
function ComisionBancariaCampo({ opcion, onCambiar, plan, monto, nombre = 'lleva-comision-bancaria' }: Props) {
  return (
    <fieldset className="rounded-lg border border-border p-3 space-y-3">
      <legend className="px-1 text-xs font-medium text-text-secondary">¿Lleva comisión bancaria del {PORCENTAJE}?</legend>
      <div className="flex gap-2">
        {OPCIONES.map(o => (
          <label
            key={o.valor}
            className={`flex flex-1 cursor-pointer items-center justify-center rounded-lg border-2 py-2 text-sm font-medium transition-all ${
              opcion === o.valor ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-border text-text-secondary hover:bg-surface-alt'
            }`}
          >
            <input
              type="radio"
              name={nombre}
              value={o.valor}
              checked={opcion === o.valor}
              onChange={() => onCambiar(o.valor)}
              className="sr-only"
              required
            />
            {o.etiqueta}
          </label>
        ))}
      </div>
      {opcion === '' && (
        <p className="text-xs text-text-muted">
          Elige Sí o No. Si es Sí, el banco cobra el {PORCENTAJE} del monto (mínimo Bs {MINIMO_COMISION_BANCARIA_BS}) y se carga a esta misma cuenta.
        </p>
      )}
      {opcion === 'no' && <p className="text-xs text-text-muted">Se debitará solo el monto del movimiento.</p>}
      <Resumen plan={plan} monto={monto} />
    </fieldset>
  );
}

/**
 * Aviso cuando aún no se sabe si la comisión aplica (cargando o error de red). En error ofrece reintentar: sin
 * esto la pregunta Sí/No quedaría oculta mientras el servidor la exige.
 */
export function AvisoComisionNoVerificada({ mensaje, enError, onReintentar }: { mensaje: string; enError: boolean; onReintentar: () => void }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-2" role={enError ? 'alert' : 'status'}>
      <p>{mensaje}</p>
      {enError && (
        <button type="button" onClick={onReintentar} className="rounded-md border border-amber-300 bg-surface px-3 py-1.5 font-medium hover:bg-amber-100">
          Reintentar verificación
        </button>
      )}
    </div>
  );
}

/** Texto breve cuando la mesa de cambio reemplaza a la comisión bancaria. */
export function AvisoMesaSinComisionBancaria() {
  return <p className="text-xs text-text-muted">{TEXTO_MESA_SIN_COMISION_BANCARIA}</p>;
}

export default ComisionBancariaCampo;
