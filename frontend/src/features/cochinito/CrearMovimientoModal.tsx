import { useState } from 'react';
import { X, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { crearMovimiento } from '../../services/banca-service';
import { useAuth } from '../../hooks/use-auth';
import type { Banca } from '@shared/types/index.js';

interface Props {
  bancas: Banca[];
  onClose: () => void;
  onCreado: () => void;
}

type Tipo = 'ingreso' | 'egreso';

function CrearMovimientoModal({ bancas, onClose, onCreado }: Props) {
  const { usuario } = useAuth();
  const [tipo, setTipo] = useState<Tipo>('ingreso');
  const [bancaId, setBancaId] = useState(bancas[0]?.id ?? '');
  const [monto, setMonto] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [referencia, setReferencia] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bancaActual = bancas.find(b => b.id === bancaId);
  const montoNum = parseFloat(monto);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!bancaActual) {
      setError('Selecciona una banca válida.');
      return;
    }
    if (!montoNum || montoNum <= 0) {
      setError('El monto debe ser mayor a 0.');
      return;
    }
    if (tipo === 'egreso' && montoNum > bancaActual.saldo) {
      setError(`Saldo insuficiente. Disponible: ${bancaActual.moneda === 'USD' ? '$' : 'Bs '}${bancaActual.saldo.toLocaleString()}`);
      return;
    }

    setGuardando(true);
    const result = await crearMovimiento({
      tipo,
      bancaId,
      monto: montoNum,
      moneda: bancaActual.moneda,
      descripcion: descripcion.trim(),
      referencia: referencia.trim(),
      fecha,
      registradoPor: usuario?.id ?? '',
    });
    setGuardando(false);

    if (result) {
      onCreado();
    } else {
      setError('No se pudo crear el movimiento. Verifica los datos e intenta de nuevo.');
    }
  };

  const inputClass = "w-full px-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-surface">
          <h2 className="text-lg font-bold text-text-primary">Nuevo movimiento</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Selector de tipo */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-2">Tipo de movimiento</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTipo('ingreso')}
                className={`flex items-center justify-center gap-2 py-3 rounded-lg border-2 text-sm font-medium transition-all ${
                  tipo === 'ingreso'
                    ? 'border-green-500 bg-green-50 text-green-700'
                    : 'border-border text-text-secondary hover:bg-surface-alt'
                }`}
              >
                <ArrowDownLeft size={16} />
                Ingreso
              </button>
              <button
                type="button"
                onClick={() => setTipo('egreso')}
                className={`flex items-center justify-center gap-2 py-3 rounded-lg border-2 text-sm font-medium transition-all ${
                  tipo === 'egreso'
                    ? 'border-red-500 bg-red-50 text-red-700'
                    : 'border-border text-text-secondary hover:bg-surface-alt'
                }`}
              >
                <ArrowUpRight size={16} />
                Egreso
              </button>
            </div>
          </div>

          {/* Banca */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Banca {tipo === 'ingreso' ? 'destino' : 'origen'}
            </label>
            <select required value={bancaId} onChange={e => setBancaId(e.target.value)} className={inputClass}>
              {bancas.map(b => (
                <option key={b.id} value={b.id}>
                  {b.nombre} — {b.moneda === 'USD' ? '$' : 'Bs '}{b.saldo.toLocaleString()}
                </option>
              ))}
            </select>
          </div>

          {/* Monto */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Monto {bancaActual && <span className="text-text-muted">({bancaActual.moneda})</span>}
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">
                {bancaActual?.moneda === 'USD' ? '$' : 'Bs'}
              </span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={monto}
                onChange={e => setMonto(e.target.value)}
                className={`${inputClass} pl-9`}
                placeholder="0.00"
              />
            </div>
            {tipo === 'egreso' && bancaActual && montoNum > bancaActual.saldo && (
              <p className="text-xs text-red-500 mt-1">Excede el saldo disponible</p>
            )}
          </div>

          {/* Fecha */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Fecha</label>
            <input
              type="date"
              required
              value={fecha}
              onChange={e => setFecha(e.target.value)}
              className={inputClass}
            />
          </div>

          {/* Descripción */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Descripción</label>
            <input
              type="text"
              required
              maxLength={200}
              value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              className={inputClass}
              placeholder={tipo === 'ingreso' ? 'Ej: Depósito mensual' : 'Ej: Pago a proveedor X'}
            />
          </div>

          {/* Referencia */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Referencia <span className="text-text-muted">(opcional)</span>
            </label>
            <input
              type="text"
              maxLength={50}
              value={referencia}
              onChange={e => setReferencia(e.target.value)}
              className={inputClass}
              placeholder="Ej: OC-2026-001, TRF-432"
            />
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
            <button
              type="submit"
              disabled={guardando}
              className={`flex-1 py-2.5 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                tipo === 'ingreso' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {guardando ? 'Registrando...' : `Registrar ${tipo}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CrearMovimientoModal;
