import { useState } from 'react';
import { X, Building2, Globe, Coins, Wallet } from 'lucide-react';
import { crearBanca, actualizarBanca } from '../../services/banca-service';
import type { Banca, TipoBanca } from '@shared/types/index.js';

interface TipoOption {
  value: TipoBanca;
  label: string;
  icon: React.ReactNode;
  hint: string;
}

const TIPOS: TipoOption[] = [
  { value: 'banco_nacional',      label: 'Banco Nacional',      icon: <Building2 size={18} />, hint: 'Cuenta bancaria en Venezuela' },
  { value: 'banco_internacional', label: 'Banco Internacional', icon: <Globe size={18} />,     hint: 'Cuenta bancaria en el exterior' },
  { value: 'exchange',            label: 'Exchange',            icon: <Coins size={18} />,     hint: 'Plataforma cripto (Binance, etc.)' },
  { value: 'efectivo',            label: 'Efectivo',            icon: <Wallet size={18} />,    hint: 'Caja física presencial' },
];

interface Props {
  banca?: Banca | null;
  onClose: () => void;
  onGuardado: () => void;
}

function BancaFormModal({ banca, onClose, onGuardado }: Props) {
  const editando = !!banca;
  const [nombre, setNombre] = useState(banca?.nombre ?? '');
  const [tipo, setTipo] = useState<TipoBanca>(banca?.tipo ?? 'banco_nacional');
  const [moneda, setMoneda] = useState(banca?.moneda ?? 'USD');
  const [descripcion, setDescripcion] = useState(banca?.descripcion ?? '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const nombreTrim = nombre.trim();
    if (!nombreTrim) {
      setError('El nombre es obligatorio.');
      return;
    }

    setGuardando(true);

    let ok = false;
    if (editando && banca) {
      ok = await actualizarBanca(banca.id, {
        nombre: nombreTrim,
        tipo,
        descripcion: descripcion.trim(),
      });
    } else {
      const result = await crearBanca({
        nombre: nombreTrim,
        tipo,
        moneda,
        descripcion: descripcion.trim(),
      });
      ok = !!result;
    }

    setGuardando(false);

    if (ok) {
      onGuardado();
    } else {
      setError(`No se pudo ${editando ? 'actualizar' : 'crear'} la banca. Intenta de nuevo.`);
    }
  };

  const inputClass = "w-full px-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-surface">
          <h2 className="text-lg font-bold text-text-primary">
            {editando ? 'Editar banca' : 'Nueva banca'}
          </h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Tipo de banca — selector visual */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-2">Tipo de banca</label>
            <div className="grid grid-cols-2 gap-2">
              {TIPOS.map(t => {
                const activo = tipo === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTipo(t.value)}
                    className={`flex flex-col items-start gap-1 p-3 rounded-lg border-2 text-left transition-all ${
                      activo
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-border text-text-secondary hover:bg-surface-alt'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {t.icon}
                      <span className="text-sm font-medium">{t.label}</span>
                    </div>
                    <span className={`text-xs ${activo ? 'text-brand-600' : 'text-text-muted'}`}>{t.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Nombre */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Nombre</label>
            <input
              type="text"
              required
              maxLength={80}
              value={nombre}
              onChange={e => setNombre(e.target.value)}
              className={inputClass}
              placeholder="Ej: BNC USD, Binance USDT, Caja chica"
            />
          </div>

          {/* Moneda — solo al crear */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Moneda {editando && <span className="text-text-muted">(no editable)</span>}
            </label>
            <select
              value={moneda}
              onChange={e => setMoneda(e.target.value)}
              disabled={editando}
              className={`${inputClass} ${editando ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <option value="USD">USD — Dólares estadounidenses</option>
              <option value="VES">VES — Bolívares</option>
            </select>
            {editando && (
              <p className="text-xs text-text-muted mt-1">
                Cambiar la moneda rompería el histórico de movimientos.
              </p>
            )}
          </div>

          {/* Descripción */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Descripción <span className="text-text-muted">(opcional)</span>
            </label>
            <textarea
              maxLength={200}
              rows={2}
              value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              className={`${inputClass} resize-none`}
              placeholder="Ej: Cuenta operativa principal"
            />
          </div>

          {!editando && (
            <div className="bg-brand-50 border border-brand-200 rounded-lg p-3 text-xs text-brand-800">
              <strong>Saldo inicial:</strong> la banca se crea con saldo 0. Para establecer un saldo inicial,
              registra un movimiento de "Ingreso" después de crearla.
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
            >
              {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Crear banca'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default BancaFormModal;
