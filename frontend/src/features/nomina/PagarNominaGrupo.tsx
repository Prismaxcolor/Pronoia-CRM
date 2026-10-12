import SelectorBanca from '../cochinito/SelectorBanca';
import ComisionBancariaCampo, { AvisoComisionNoVerificada } from '../cochinito/ComisionBancariaCampo';
import { bloqueoPorComision, planDeComision, type EstadoComision } from '../cochinito/comision-formulario';
import type { Banca } from '../../../../shared/types/banca.js';
import {
  ELECCION_VACIA, ETIQUETA_GRUPO, cuentasDeGrupo, formatearMontoPago, preguntaComision, type EleccionPago, type GrupoPago,
} from './nomina-pago';

interface Props {
  grupo: GrupoPago;
  bancas: readonly Banca[];
  eleccion: EleccionPago | undefined;
  comisionDisponible: boolean;
  estadoComision: EstadoComision;
  onReintentarComision: () => void;
  onCambiar: (eleccion: EleccionPago) => void;
}

/** Un grupo de pago (divisas o bolívares): resumen del monto, selector de cuenta con su saldo y, en Bs, la comisión bancaria. */
function PagarNominaGrupo({ grupo, bancas, eleccion, comisionDisponible, estadoComision, onReintentarComision, onCambiar }: Props) {
  const actual = eleccion ?? ELECCION_VACIA;
  const cuentas = cuentasDeGrupo(bancas, grupo.moneda);
  const banca = cuentas.find(b => b.id === actual.bancaId);
  const pregunta = preguntaComision(banca, comisionDisponible);
  const bloqueo = banca ? bloqueoPorComision({ estado: estadoComision, tipo: 'egreso', moneda: banca.moneda, mesaActiva: false }) : null;
  const plan = banca
    ? planDeComision({ ofrecida: pregunta, tipo: 'egreso', moneda: banca.moneda, monto: grupo.monto, opcion: actual.comision, saldo: banca.saldo })
    : { ok: true as const, aplica: false as const, comision: 0 as const, totalDebitado: grupo.monto };

  return (
    <section className="space-y-3 rounded-xl border border-border p-3" aria-label={`Pago en ${ETIQUETA_GRUPO[grupo.moneda]}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-primary">{ETIQUETA_GRUPO[grupo.moneda]} · {grupo.cantidad} trabajador{grupo.cantidad === 1 ? '' : 'es'}</h3>
        <p className="text-sm font-semibold tabular-nums text-text-primary">
          {formatearMontoPago(grupo.moneda, grupo.monto)}
          {grupo.moneda === 'BS' && <span className="ml-2 text-xs font-normal text-text-secondary">equivale a {formatearMontoPago('USD', grupo.montoUsd)}</span>}
        </p>
      </div>
      <SelectorBanca
        bancas={cuentas}
        valor={actual.bancaId}
        titulo={`Cuenta de la que sale el pago en ${grupo.moneda === 'USD' ? 'divisas' : 'bolívares'}`}
        placeholder="— Elige la cuenta —"
        ariaLabel={`Cuenta para el pago en ${grupo.moneda === 'USD' ? 'divisas' : 'bolívares'}`}
        onChange={id => onCambiar({ bancaId: id, comision: id === actual.bancaId ? actual.comision : '' })}
      />
      {cuentas.length === 0 && (
        <p role="alert" className="text-xs text-red-600">No tienes cuentas {grupo.moneda === 'USD' ? 'en USD' : 'en bolívares'} con acceso de edición.</p>
      )}
      {bloqueo && <AvisoComisionNoVerificada mensaje={bloqueo} enError={estadoComision === 'error'} onReintentar={onReintentarComision} />}
      {banca && pregunta && (
        <ComisionBancariaCampo opcion={actual.comision} onCambiar={comision => onCambiar({ ...actual, comision })} plan={plan} monto={grupo.monto} />
      )}
    </section>
  );
}

export default PagarNominaGrupo;
