import { useEffect, useState } from 'react';
import SelectorBanca from '../cochinito/SelectorBanca';
import ComisionBancariaCampo, { AvisoComisionNoVerificada } from '../cochinito/ComisionBancariaCampo';
import { bloqueoPorComision, planDeComision, type EstadoComision } from '../cochinito/comision-formulario';
import FotoMultiplePicker from '../../components/FotoMultiplePicker';
import { obtenerTasa } from '../../services/tasa-service';
import { formatearNumero } from '../../lib/formato';
import type { Banca } from '../../../../shared/types/banca.js';
import type { useComprobantesPago } from './useComprobantesPago';
import {
  cuentasDeDesembolso, montoDeDesembolso, preguntaComisionDesembolso, type EstadoDesembolso,
} from './nomina-desembolso';

interface Props {
  /** Monto del préstamo en USD (null mientras el formulario aún no lo tiene). */
  montoUsd: number | null;
  bancas: readonly Banca[];
  estado: EstadoDesembolso;
  onCambiar: (estado: EstadoDesembolso) => void;
  comisionDisponible: boolean;
  estadoComision: EstadoComision;
  onReintentarComision: () => void;
  comprobantes: ReturnType<typeof useComprobantesPago>;
}

const inputClass = 'w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400';
const labelClass = 'block text-xs font-medium text-text-secondary mb-1';

/** Tasa Binance de hoy como sugerencia para la tasa del pago en Bs (la persona puede escribir otra). */
function useTasaSugerida(activo: boolean): number | null {
  const [tasa, setTasa] = useState<number | null>(null);
  useEffect(() => {
    if (!activo) return undefined;
    let vivo = true;
    void obtenerTasa('binance').then(t => { if (vivo) setTasa(t?.tasa ?? null); });
    return () => { vivo = false; };
  }, [activo]);
  return tasa;
}

/**
 * Campos del pago de un préstamo desde el Wallet: cuenta de origen, fecha, referencia, tasa (solo cuentas en Bs), comisión
 * bancaria (solo cuentas en Bs) y foto del comprobante. Se usa al crear el préstamo y en «Registrar pago».
 */
function DesembolsoCampos({
  montoUsd, bancas, estado, onCambiar, comisionDisponible, estadoComision, onReintentarComision, comprobantes,
}: Props) {
  const cuentas = cuentasDeDesembolso(bancas);
  const banca = cuentas.find(b => b.id === estado.bancaId);
  const enBs = banca?.moneda === 'VES';
  const sugerida = useTasaSugerida(enBs);
  const monto = montoUsd === null ? null : montoDeDesembolso(montoUsd, banca, estado.tasa);
  const pregunta = preguntaComisionDesembolso(banca, comisionDisponible);
  const bloqueo = banca ? bloqueoPorComision({ estado: estadoComision, tipo: 'egreso', moneda: banca.moneda, mesaActiva: false }) : null;
  const plan = banca && monto !== null
    ? planDeComision({ ofrecida: pregunta, tipo: 'egreso', moneda: banca.moneda, monto, opcion: estado.comision, saldo: banca.saldo })
    : { ok: true as const, aplica: false as const, comision: 0 as const, totalDebitado: monto ?? 0 };

  return (
    <div className="space-y-3">
      <SelectorBanca
        bancas={cuentas}
        valor={estado.bancaId}
        titulo="Cuenta de la que sale el pago"
        placeholder="— Elige la cuenta —"
        ariaLabel="Cuenta de la que sale el pago del préstamo"
        onChange={id => onCambiar({ ...estado, bancaId: id, comision: id === estado.bancaId ? estado.comision : '' })}
      />
      {cuentas.length === 0 && <p role="alert" className="text-xs text-red-600">No tienes cuentas en USD o en bolívares con acceso de edición.</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="desembolso-fecha" className={labelClass}>Fecha del pago *</label>
          <input id="desembolso-fecha" type="date" value={estado.fecha} onChange={e => onCambiar({ ...estado, fecha: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label htmlFor="desembolso-ref" className={labelClass}>Referencia (opcional)</label>
          <input id="desembolso-ref" maxLength={50} value={estado.referencia} onChange={e => onCambiar({ ...estado, referencia: e.target.value })} className={inputClass} />
        </div>
      </div>
      {enBs && (
        <div>
          <label htmlFor="desembolso-tasa" className={labelClass}>Tasa del pago (Bs por USD) *</label>
          <input id="desembolso-tasa" inputMode="decimal" value={estado.tasa} onChange={e => onCambiar({ ...estado, tasa: e.target.value })} className={inputClass} />
          {sugerida !== null && estado.tasa.trim() !== String(sugerida) && (
            <button type="button" onClick={() => onCambiar({ ...estado, tasa: String(sugerida) })} className="mt-1 text-xs text-brand-700 underline">
              Usar la tasa Binance de hoy ({formatearNumero(sugerida, 2)})
            </button>
          )}
          {monto !== null && montoUsd !== null && (
            <p className="mt-1 text-xs text-text-secondary">Se pagan <strong>Bs {formatearNumero(monto, 2)}</strong> (USD {formatearNumero(montoUsd, 2)} a esa tasa).</p>
          )}
        </div>
      )}
      {bloqueo && <AvisoComisionNoVerificada mensaje={bloqueo} enError={estadoComision === 'error'} onReintentar={onReintentarComision} />}
      {banca && pregunta && monto !== null && (
        <ComisionBancariaCampo opcion={estado.comision} onCambiar={comision => onCambiar({ ...estado, comision })} plan={plan} monto={monto} />
      )}
      <FotoMultiplePicker fotos={comprobantes.fotos} onAgregar={comprobantes.agregar} onQuitar={comprobantes.quitar} label="Foto del comprobante de pago (opcional)" />
      {comprobantes.aviso && <p role="status" className="text-xs text-amber-700">{comprobantes.aviso}</p>}
    </div>
  );
}

export default DesembolsoCampos;
