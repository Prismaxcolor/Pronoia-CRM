import { Trash2 } from 'lucide-react';
import SelectorBanca from '../cochinito/SelectorBanca';
import type { EstadoTasasUsd } from '../cochinito/equivalente-usd';
import type { EstadoComision, OpcionComision } from '../cochinito/comision-formulario';
import type { Banca } from '@shared/types/index.js';
import LineaPagoBs from './LineaPagoBs';
import { FUENTE_TASA_PAGO_INICIAL, type FuenteTasaPago } from './pago-bs-tasa';

export interface LineaBanca {
  id: number;
  bancaId: string;
  /** USD, string editable. */
  montoUsd: string;
  /** Referencia propia de esta banca (ej. número de transferencia). */
  referencia: string;
  /** Solo pago a proveedor desde una cuenta en Bs. Opcionales: un borrador viejo no los trae (ver pago-bs-tasa.ts). */
  tasaFuente?: FuenteTasaPago;
  /** Tasa manual (Bs por USD), texto editable. */
  tasaManual?: string;
  /** ¿Lleva comisión bancaria? '' = aún sin elegir. */
  comision?: OpcionComision;
}

interface Props {
  linea: LineaBanca;
  /** Cuenta elegida (undefined mientras no se elige). */
  banca: Banca | undefined;
  /** Cuentas que se pueden elegir en esta línea (la propia más las que ningún otro renglón usa). */
  bancasElegibles: Banca[];
  esProveedor: boolean;
  puedeQuitar: boolean;
  /** Bs por USD con la que se calcula esta línea (la elegida en pago a proveedor; la BCV en cobro); null si no hay. */
  tasaBs: number | null;
  tasasUsd: EstadoTasasUsd;
  comisionEstado: EstadoComision;
  onBanca: (bancaId: string) => void;
  onMonto: (montoUsd: string) => void;
  onReferencia: (referencia: string) => void;
  onCampos: (campos: Partial<LineaBanca>) => void;
  onQuitar: () => void;
  onReintentarComision: () => void;
}

const inputClass = 'w-full px-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

/** Un renglón del "Registrar pago/cobro": cuenta, monto en USD, referencia y, en un pago a proveedor desde Bs, tasa y comisión. */
function FilaBancaPago({
  linea, banca, bancasElegibles, esProveedor, puedeQuitar, tasaBs, tasasUsd, comisionEstado,
  onBanca, onMonto, onReferencia, onCampos, onQuitar, onReintentarComision,
}: Props) {
  const esBsLinea = banca?.moneda === 'VES';
  const montoUsdLinea = parseFloat(linea.montoUsd) || 0;
  const montoBsLinea = esBsLinea && tasaBs ? montoUsdLinea * tasaBs : null;
  return (
    <div className="border border-border rounded-lg p-2 space-y-2">
      <div className="flex flex-col sm:flex-row items-start gap-2">
        <SelectorBanca
          bancas={bancasElegibles}
          valor={linea.bancaId}
          placeholder="— Selecciona la cuenta o caja —"
          ariaLabel="Cuenta o caja"
          className="w-full sm:flex-1"
          onChange={onBanca}
        />
        <div className="flex items-start gap-2 w-full sm:w-auto">
          <div className="shrink-0">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">$</span>
              <input
                type="number" step="0.001" min="0.01"
                value={linea.montoUsd}
                onChange={e => onMonto(e.target.value)}
                className={`${inputClass} w-28 pl-6`}
                placeholder="0.00"
              />
            </div>
            {montoBsLinea != null && (
              <p className="text-xs text-text-muted mt-1 text-right">≈ Bs {fmt(montoBsLinea)}</p>
            )}
          </div>
          {puedeQuitar && (
            <button
              type="button"
              onClick={onQuitar}
              className="p-2.5 text-text-muted hover:text-red-600 transition-colors shrink-0"
              title="Quitar banca"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>
      <input
        type="text" maxLength={50}
        value={linea.referencia}
        onChange={e => onReferencia(e.target.value)}
        className={`${inputClass} text-xs`}
        placeholder="Referencia de esta banca (opcional) — ej: TRF-432"
      />
      {esProveedor && esBsLinea && (
        <LineaPagoBs
          idLinea={linea.id}
          montoUsd={montoUsdLinea}
          fuente={linea.tasaFuente ?? FUENTE_TASA_PAGO_INICIAL}
          tasaManual={linea.tasaManual ?? ''}
          tasasUsd={tasasUsd}
          comisionOpcion={linea.comision ?? ''}
          comisionEstado={comisionEstado}
          onFuente={tasaFuente => onCampos({ tasaFuente })}
          onTasaManual={tasaManual => onCampos({ tasaManual })}
          onComision={comision => onCampos({ comision })}
          onReintentarComision={onReintentarComision}
        />
      )}
    </div>
  );
}

export default FilaBancaPago;
