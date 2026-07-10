import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { obtenerBancas } from '../../services/banca-service';
import { obtenerTasaOficial } from '../../services/tasa-service';
import { obtenerFacturas } from '../../services/factura-cv-service';
import { registrarPago } from '../../services/pago-service';
import type { Banca } from '@shared/types/index.js';
import type { FacturaCV } from '../../services/factura-cv-service';

interface Props {
  proveedorId: string;
  /** Si se pasa, el pago se liga a esta factura (no se puede elegir otra). */
  facturaId?: string;
  /** Saldo pendiente de esa factura (total - montoPagado). Requerido junto con facturaId. */
  saldoPendiente?: number;
  onClose: () => void;
  onRegistrado: () => void;
}

const SIN_FACTURA = '__adelanto__';

function RegistrarPagoModal({ proveedorId, facturaId, saldoPendiente, onClose, onRegistrado }: Props) {
  const facturaFija = !!facturaId;

  const [bancas, setBancas] = useState<Banca[]>([]);
  const [bancaId, setBancaId] = useState('');
  const [tasa, setTasa] = useState<number | null>(null);
  const [facturasPendientes, setFacturasPendientes] = useState<FacturaCV[]>([]);
  const [facturaSelId, setFacturaSelId] = useState<string>(facturaId ?? SIN_FACTURA);

  const [montoUsd, setMontoUsd] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0]);
  const [descripcion, setDescripcion] = useState('');
  const [referencia, setReferencia] = useState('');

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    obtenerBancas().then(lista => {
      setBancas(lista);
      setBancaId(lista[0]?.id ?? '');
    });
    obtenerTasaOficial().then(t => setTasa(t?.tasa ?? null));
    if (!facturaFija) {
      obtenerFacturas('compra', { entidadId: proveedorId }).then(lista =>
        setFacturasPendientes(lista.filter(f => f.estado !== 'pagada'))
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proveedorId]);

  const facturaElegida = useMemo(
    () => facturasPendientes.find(f => f.id === facturaSelId),
    [facturasPendientes, facturaSelId]
  );

  const saldoAplicable = facturaFija
    ? saldoPendiente ?? Infinity
    : facturaSelId !== SIN_FACTURA && facturaElegida
      ? facturaElegida.total - facturaElegida.montoPagado
      : null;

  const bancaActual = bancas.find(b => b.id === bancaId);
  const montoUsdNum = parseFloat(montoUsd) || 0;
  const esBs = bancaActual?.moneda === 'VES';
  const montoBancaMoneda = esBs && tasa ? montoUsdNum * tasa : montoUsdNum;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!bancaActual) { setError('Selecciona una banca válida.'); return; }
    if (!montoUsdNum || montoUsdNum <= 0) { setError('El monto debe ser mayor a 0.'); return; }
    if (esBs && !tasa) { setError('No hay tasa de cambio disponible para convertir a bolívares.'); return; }
    if (montoBancaMoneda > bancaActual.saldo) {
      setError(`Saldo insuficiente en ${bancaActual.nombre}. Disponible: ${bancaActual.moneda === 'USD' ? '$' : 'Bs '}${bancaActual.saldo.toLocaleString()}`);
      return;
    }
    if (saldoAplicable != null && montoUsdNum > saldoAplicable + 0.01) {
      setError(`El monto supera el saldo pendiente de la factura ($${saldoAplicable.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}). Para un pago mayor, regístralo como adelanto.`);
      return;
    }

    const facturaAplicada = facturaFija ? facturaId! : (facturaSelId !== SIN_FACTURA ? facturaSelId : null);

    setGuardando(true);
    const result = await registrarPago({
      proveedorId,
      bancaId,
      monto: montoBancaMoneda,
      moneda: esBs ? 'VES' : 'USD',
      montoUsd: montoUsdNum,
      descripcion: descripcion.trim() || null,
      referencia: referencia.trim() || null,
      fecha,
      facturaId: facturaAplicada,
    });
    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    onRegistrado();
  };

  const inputClass = "w-full px-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-surface">
          <h2 className="text-lg font-bold text-text-primary">Registrar pago</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {!facturaFija && (
            <div>
              <label className={labelClass}>Aplicar a factura</label>
              <select value={facturaSelId} onChange={e => setFacturaSelId(e.target.value)} className={inputClass}>
                <option value={SIN_FACTURA}>— Adelanto (sin factura específica) —</option>
                {facturasPendientes.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.codigo ?? f.id.slice(0, 8)} · saldo ${(f.total - f.montoPagado).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className={labelClass}>Banca de origen *</label>
            <select required value={bancaId} onChange={e => setBancaId(e.target.value)} className={inputClass}>
              {bancas.map(b => (
                <option key={b.id} value={b.id}>
                  {b.nombre} — {b.moneda === 'USD' ? '$' : 'Bs '}{b.saldo.toLocaleString()}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Monto (USD) *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">$</span>
              <input
                type="number" step="0.01" min="0.01" required
                value={montoUsd}
                onChange={e => setMontoUsd(e.target.value)}
                className={`${inputClass} pl-7`}
                placeholder="0.00"
              />
            </div>
            {esBs && (
              <p className="text-xs text-text-muted mt-1">
                {tasa
                  ? `Equivalente a transferir: Bs ${montoBancaMoneda.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (tasa ${tasa.toLocaleString()})`
                  : 'No se pudo obtener la tasa de cambio.'}
              </p>
            )}
            {saldoAplicable != null && Number.isFinite(saldoAplicable) && (
              <p className="text-xs text-text-muted mt-1">
                Saldo pendiente de la factura: ${saldoAplicable.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            )}
          </div>

          <div>
            <label className={labelClass}>Fecha</label>
            <input type="date" required value={fecha} onChange={e => setFecha(e.target.value)} className={inputClass} />
          </div>

          <div>
            <label className={labelClass}>Descripción <span className="text-text-muted">(opcional)</span></label>
            <input type="text" maxLength={200} value={descripcion} onChange={e => setDescripcion(e.target.value)} className={inputClass} placeholder="Ej: Pago factura Compra 0012" />
          </div>

          <div>
            <label className={labelClass}>Referencia <span className="text-text-muted">(opcional)</span></label>
            <input type="text" maxLength={50} value={referencia} onChange={e => setReferencia(e.target.value)} className={inputClass} placeholder="Ej: TRF-432" />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? 'Registrando...' : 'Registrar pago'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default RegistrarPagoModal;
