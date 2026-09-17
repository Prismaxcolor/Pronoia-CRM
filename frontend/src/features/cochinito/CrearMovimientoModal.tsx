import { useEffect, useState } from 'react';
import { X, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, ChevronDown } from 'lucide-react';
import SeleccionarEntidadModal from '../../components/SeleccionarEntidadModal';
import { crearMovimiento } from '../../services/banca-service';
import { obtenerProveedores } from '../../services/proveedor-service';
import { obtenerClientes } from '../../services/cliente-service';
import { obtenerTasa, type FuenteTasaKey } from '../../services/tasa-service';
import { useAuth } from '../../hooks/use-auth-context';
import type { Banca } from '@shared/types/index.js';

interface Props {
  bancas: Banca[];
  onClose: () => void;
  onCreado: () => void;
}

type Tipo = 'ingreso' | 'egreso' | 'transferencia';
interface Entidad { id: string; nombre: string; activo: boolean; fotos?: string[] }

/** Fuentes de tasa disponibles para sugerir el monto destino en una
 *  transferencia entre bancas de monedas distintas (USD↔Bs). */
const FUENTES_TASA: { key: FuenteTasaKey; label: string }[] = [
  { key: 'bcv', label: 'BCV' },
  { key: 'binance', label: 'Binance' },
];

function CrearMovimientoModal({ bancas, onClose, onCreado }: Props) {
  const { usuario } = useAuth();
  const [tipo, setTipo] = useState<Tipo>('ingreso');
  const [bancaId, setBancaId] = useState(bancas[0]?.id ?? '');
  const [bancaDestinoId, setBancaDestinoId] = useState('');
  const [monto, setMonto] = useState('');
  const [montoDestino, setMontoDestino] = useState('');
  const [montoDestinoTocado, setMontoDestinoTocado] = useState(false);
  const [tasaFuente, setTasaFuente] = useState<FuenteTasaKey>('bcv');
  const [tasas, setTasas] = useState<Partial<Record<FuenteTasaKey, number>>>({});
  const [descripcion, setDescripcion] = useState('');
  const [referencia, setReferencia] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Atribución opcional a proveedor (egreso = pago) o cliente (ingreso = cobro)
  const [proveedores, setProveedores] = useState<Entidad[]>([]);
  const [clientes, setClientes] = useState<Entidad[]>([]);
  const [entidadId, setEntidadId] = useState('');
  const [mostrarSelectorEntidad, setMostrarSelectorEntidad] = useState(false);

  useEffect(() => {
    obtenerProveedores().then(lista => setProveedores(lista.filter(p => p.activo)));
    obtenerClientes().then(lista => setClientes(lista.filter(c => c.activo)));
  }, []);

  // Al cambiar de tipo, se limpia la atribución (proveedor↔cliente no se mezclan)
  // y la selección de banca destino (solo aplica a transferencia).
  const cambiarTipo = (nuevo: Tipo) => {
    setTipo(nuevo);
    setEntidadId('');
    setBancaDestinoId('');
    setMontoDestinoTocado(false);
  };

  const bancaActual = bancas.find(b => b.id === bancaId);
  const bancaDestino = bancas.find(b => b.id === bancaDestinoId);
  const bancasDestinoDisponibles = bancas.filter(b => b.id !== bancaId);
  const montoNum = parseFloat(monto) || 0;
  const monedasDistintas = tipo === 'transferencia' && !!bancaActual && !!bancaDestino && bancaActual.moneda !== bancaDestino.moneda;

  // Tasas para sugerir el monto destino, solo cuando hacen falta.
  useEffect(() => {
    if (!monedasDistintas) return;
    FUENTES_TASA.forEach(({ key }) => {
      if (tasas[key] != null) return;
      obtenerTasa(key).then(t => {
        if (t) setTasas(prev => ({ ...prev, [key]: t.tasa }));
      });
    });
  }, [monedasDistintas, tasas]);

  // Monto destino sugerido a partir de la tasa elegida — derivado en cada
  // render, no vive en el estado, para no disparar setState desde un efecto.
  // Mientras el usuario no lo edite a mano, el campo muestra este valor.
  const tasaElegida = tasas[tasaFuente];
  const montoDestinoSugerido = monedasDistintas && tasaElegida && montoNum
    ? (bancaActual!.moneda === 'USD' ? montoNum * tasaElegida : montoNum / tasaElegida)
    : null;
  const montoDestinoMostrado = montoDestinoTocado
    ? montoDestino
    : (montoDestinoSugerido != null ? montoDestinoSugerido.toFixed(2) : '');
  const montoDestinoNum = parseFloat(montoDestinoMostrado) || 0;

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
    if ((tipo === 'egreso' || tipo === 'transferencia') && montoNum > bancaActual.saldo) {
      setError(`Saldo insuficiente. Disponible: ${bancaActual.moneda === 'USD' ? '$' : 'Bs '}${bancaActual.saldo.toLocaleString()}`);
      return;
    }
    if (tipo === 'transferencia') {
      if (!bancaDestino) { setError('Selecciona la banca destino.'); return; }
      if (monedasDistintas && montoDestinoNum <= 0) {
        setError('Ingresa el monto que llega a la banca destino.');
        return;
      }
    }

    setGuardando(true);
    const result = await crearMovimiento({
      tipo,
      bancaId,
      bancaDestinoId: tipo === 'transferencia' ? bancaDestinoId : null,
      monto: montoNum,
      montoDestino: monedasDistintas ? montoDestinoNum : null,
      moneda: bancaActual.moneda,
      descripcion: descripcion.trim(),
      referencia: referencia.trim(),
      fecha,
      registradoPor: usuario?.id ?? '',
      proveedorId: tipo === 'egreso' ? entidadId || null : null,
      clienteId: tipo === 'ingreso' ? entidadId || null : null,
    });
    setGuardando(false);

    if (result) {
      onCreado();
    } else {
      setError('No se pudo crear el movimiento. Verifica los datos e intenta de nuevo.');
    }
  };

  const inputClass = "w-full px-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";

  const colorTipo = tipo === 'ingreso' ? 'green' : tipo === 'egreso' ? 'red' : 'blue';

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
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => cambiarTipo('ingreso')}
                className={`flex flex-col items-center justify-center gap-1 py-3 rounded-lg border-2 text-xs font-medium transition-all ${
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
                onClick={() => cambiarTipo('egreso')}
                className={`flex flex-col items-center justify-center gap-1 py-3 rounded-lg border-2 text-xs font-medium transition-all ${
                  tipo === 'egreso'
                    ? 'border-red-500 bg-red-50 text-red-700'
                    : 'border-border text-text-secondary hover:bg-surface-alt'
                }`}
              >
                <ArrowUpRight size={16} />
                Egreso
              </button>
              <button
                type="button"
                onClick={() => cambiarTipo('transferencia')}
                className={`flex flex-col items-center justify-center gap-1 py-3 rounded-lg border-2 text-xs font-medium transition-all ${
                  tipo === 'transferencia'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-border text-text-secondary hover:bg-surface-alt'
                }`}
              >
                <ArrowLeftRight size={16} />
                Transferencia
              </button>
            </div>
          </div>

          {/* Banca origen */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Banca {tipo === 'ingreso' ? 'destino' : tipo === 'egreso' ? 'origen' : 'de origen'}
            </label>
            <select
              required
              value={bancaId}
              onChange={e => {
                setBancaId(e.target.value);
                if (bancaDestinoId === e.target.value) setBancaDestinoId('');
              }}
              className={inputClass}
            >
              {bancas.map(b => (
                <option key={b.id} value={b.id}>
                  {b.nombre} — {b.moneda === 'USD' ? '$' : 'Bs '}{b.saldo.toLocaleString()}
                </option>
              ))}
            </select>
          </div>

          {/* Banca destino — solo transferencia */}
          {tipo === 'transferencia' && (
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Banca de destino</label>
              <select
                required
                value={bancaDestinoId}
                onChange={e => { setBancaDestinoId(e.target.value); setMontoDestinoTocado(false); }}
                className={inputClass}
              >
                <option value="">— Selecciona —</option>
                {bancasDestinoDisponibles.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.nombre} — {b.moneda === 'USD' ? '$' : 'Bs '}{b.saldo.toLocaleString()}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Monto (origen) */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              {tipo === 'transferencia' ? 'Monto a debitar' : 'Monto'}{' '}
              {bancaActual && <span className="text-text-muted">({bancaActual.moneda})</span>}
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
            {(tipo === 'egreso' || tipo === 'transferencia') && bancaActual && montoNum > bancaActual.saldo && (
              <p className="text-xs text-red-500 mt-1">Excede el saldo disponible</p>
            )}
          </div>

          {/* Monto destino + tasa — solo transferencia entre monedas distintas */}
          {monedasDistintas && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-3">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Tasa a usar (sugerencia)</label>
                <div className="flex rounded-lg overflow-hidden border border-border text-xs w-fit">
                  {FUENTES_TASA.map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => { setTasaFuente(key); setMontoDestinoTocado(false); }}
                      className={`px-3 py-1.5 ${tasaFuente === key ? 'bg-blue-600 text-white' : 'bg-surface text-text-secondary'}`}
                    >
                      {label}{tasas[key] != null ? ` (${tasas[key]!.toLocaleString('es-VE', { maximumFractionDigits: 2 })})` : ''}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Monto que llega a {bancaDestino?.nombre ?? 'la banca destino'}{' '}
                  <span className="text-text-muted">({bancaDestino?.moneda})</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">
                    {bancaDestino?.moneda === 'USD' ? '$' : 'Bs'}
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={montoDestinoMostrado}
                    onChange={e => { setMontoDestino(e.target.value); setMontoDestinoTocado(true); }}
                    className={`${inputClass} pl-9`}
                    placeholder="0.00"
                  />
                </div>
                <p className="text-xs text-text-muted mt-1">
                  Editable — ajústalo si negociaste una tasa distinta a la sugerida.
                </p>
              </div>
            </div>
          )}

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
              placeholder={
                tipo === 'ingreso' ? 'Ej: Depósito mensual' :
                tipo === 'egreso' ? 'Ej: Pago a proveedor X' :
                'Ej: Traspaso a cuenta USD'
              }
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

          {/* Atribución a proveedor (pago) o cliente (cobro) — no aplica a transferencias entre cuentas propias */}
          {tipo !== 'transferencia' && (
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                {tipo === 'egreso' ? 'Pago a proveedor' : 'Cobro de cliente'}{' '}
                <span className="text-text-muted">(opcional)</span>
              </label>
              <button
                type="button"
                onClick={() => setMostrarSelectorEntidad(true)}
                className={`${inputClass} flex items-center justify-between gap-2 text-left`}
              >
                <span className={entidadId ? 'text-text-primary truncate' : 'text-text-muted'}>
                  {(tipo === 'egreso' ? proveedores : clientes).find(e => e.id === entidadId)?.nombre ?? '— Sin atribuir —'}
                </span>
                <ChevronDown size={14} className="text-text-muted shrink-0" />
              </button>
              <p className="text-xs text-text-muted mt-1">
                Si lo atribuyes, aparece como {tipo === 'egreso' ? 'pago' : 'cobro'} en su estado de cuenta.
              </p>
            </div>
          )}

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
                colorTipo === 'green' ? 'bg-green-600 hover:bg-green-700' :
                colorTipo === 'red' ? 'bg-red-600 hover:bg-red-700' :
                'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {guardando ? 'Registrando...' : `Registrar ${tipo}`}
            </button>
          </div>
        </form>
      </div>
      {mostrarSelectorEntidad && (
        <SeleccionarEntidadModal
          titulo={tipo === 'egreso' ? 'Elegir proveedor' : 'Elegir cliente'}
          entidades={tipo === 'egreso' ? proveedores : clientes}
          onClose={() => setMostrarSelectorEntidad(false)}
          onSeleccionar={id => { setEntidadId(id); setMostrarSelectorEntidad(false); }}
        />
      )}
    </div>
  );
}

export default CrearMovimientoModal;
