import { X } from 'lucide-react';
import SelectorBanca from '../cochinito/SelectorBanca';
import ComisionBancariaCampo, { AvisoComisionNoVerificada } from '../cochinito/ComisionBancariaCampo';
import { bloqueoPorComision, planDeComision, type EstadoComision } from '../cochinito/comision-formulario';
import type { Banca } from '../../../../shared/types/banca.js';
import { preguntaComision, type GrupoPago } from './nomina-pago';
import type { EleccionPago } from './nomina-reparto';

interface Props {
  grupo: GrupoPago;
  /** Posición de la cuenta dentro del reparto (desde 0). */
  indice: number;
  fila: EleccionPago;
  /** Cuentas de la moneda que se ofrecen en esta fila (sin las ya elegidas en otras filas). */
  cuentas: readonly Banca[];
  /** Hay más de una cuenta: se pide el monto de cada una. */
  reparto: boolean;
  /** Monto de esta cuenta en centavos (con una sola cuenta es el total). */
  centavos: number;
  comisionDisponible: boolean;
  estadoComision: EstadoComision;
  onReintentarComision: () => void;
  onCambiar: (fila: EleccionPago) => void;
  onQuitar: () => void;
}

const inputClass = 'w-full min-h-[44px] px-3 py-2 bg-surface-alt border border-border rounded-lg text-base sm:text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-400';

/** Una cuenta del pago de una moneda: selector, monto (solo en reparto) y, en cuentas Bs, su propia comisión bancaria. */
function PagarNominaCuenta({
  grupo, indice, fila, cuentas, reparto, centavos, comisionDisponible, estadoComision, onReintentarComision, onCambiar, onQuitar,
}: Props) {
  const banca = cuentas.find(b => b.id === fila.bancaId);
  const pregunta = preguntaComision(banca, comisionDisponible);
  const bloqueo = banca ? bloqueoPorComision({ estado: estadoComision, tipo: 'egreso', moneda: banca.moneda, mesaActiva: false }) : null;
  const monto = centavos / 100;
  const plan = banca
    ? planDeComision({ ofrecida: pregunta, tipo: 'egreso', moneda: banca.moneda, monto, opcion: fila.comision, saldo: banca.saldo })
    : { ok: true as const, aplica: false as const, comision: 0 as const, totalDebitado: monto };
  const nombreMoneda = grupo.moneda === 'USD' ? 'divisas' : 'bolívares';
  const idMonto = `monto-${grupo.moneda}-${indice}`;

  return (
    <div className={reparto ? 'space-y-3 rounded-lg border border-border bg-surface-alt/40 p-3' : 'space-y-3'}>
      {reparto && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-text-secondary">Cuenta {indice + 1}</p>
          <button
            type="button" onClick={onQuitar} aria-label={`Quitar la cuenta ${indice + 1} del reparto en ${nombreMoneda}`}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-lg px-2 text-xs text-text-secondary hover:bg-surface-hover"
          >
            <X size={16} aria-hidden="true" />Quitar
          </button>
        </div>
      )}
      <SelectorBanca
        bancas={cuentas}
        valor={fila.bancaId}
        titulo={`Cuenta de la que sale el pago en ${nombreMoneda}`}
        placeholder="— Elige la cuenta —"
        ariaLabel={`Cuenta ${indice + 1} para el pago en ${nombreMoneda}`}
        onChange={id => onCambiar({ ...fila, bancaId: id, comision: id === fila.bancaId ? fila.comision : '' })}
      />
      {reparto && (
        <div>
          <label htmlFor={idMonto} className="mb-1 block text-xs font-medium text-text-secondary">
            Monto desde esta cuenta ({grupo.moneda === 'USD' ? 'USD' : 'Bs'})
          </label>
          <input
            id={idMonto} inputMode="decimal" autoComplete="off" placeholder="0,00" value={fila.monto}
            onChange={e => onCambiar({ ...fila, monto: e.target.value })} className={inputClass}
          />
        </div>
      )}
      {bloqueo && <AvisoComisionNoVerificada mensaje={bloqueo} enError={estadoComision === 'error'} onReintentar={onReintentarComision} />}
      {banca && pregunta && (
        <ComisionBancariaCampo opcion={fila.comision} onCambiar={comision => onCambiar({ ...fila, comision })} plan={plan} monto={monto} />
      )}
    </div>
  );
}

export default PagarNominaCuenta;
