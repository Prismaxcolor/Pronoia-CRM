import { useState } from 'react';
import { X } from 'lucide-react';
import { editarMovimiento, type EditarMovimientoInput } from '../../services/transaccion-edicion-service';
import type { Banca, Movimiento } from '@shared/types/index.js';
import CampoLlaveEdicion from '../../components/CampoLlaveEdicion';

interface Props {
  movimiento: Movimiento;
  bancas: readonly Banca[];
  onClose: () => void;
  onGuardado: (movimiento: Movimiento, advertencia?: string) => void;
}

const num = (s: string): number => Number(s.replace(',', '.'));
const ETIQUETA_TIPO = { ingreso: 'Ingreso', egreso: 'Egreso', transferencia: 'Transferencia' } as const;

/**
 * Edita un movimiento de banca manual con llave de edición. El tipo no cambia. Los pagos y cobros se editan
 * desde su comprobante (estado de cuenta), no aquí. Si cambia el monto o la banca, el servidor revierte el
 * efecto anterior en las bancas y aplica el nuevo (rechaza si alguna quedaría sin fondos).
 */
function EditarMovimientoModal({ movimiento, bancas, onClose, onGuardado }: Props) {
  const esTransferencia = movimiento.tipo === 'transferencia';
  const [bancaId, setBancaId] = useState(movimiento.bancaOrigenId);
  const [bancaDestinoId, setBancaDestinoId] = useState(movimiento.bancaDestinoId ?? '');
  const [monto, setMonto] = useState(String(movimiento.monto));
  const [montoDestino, setMontoDestino] = useState(movimiento.montoDestino != null ? String(movimiento.montoDestino) : '');
  const [descripcion, setDescripcion] = useState(movimiento.descripcion);
  const [referencia, setReferencia] = useState(movimiento.referencia);
  const [fecha, setFecha] = useState(movimiento.fecha.slice(0, 10));
  const [llave, setLlave] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const origen = bancas.find(b => b.id === bancaId);
  const destino = bancas.find(b => b.id === bancaDestinoId);
  const monedasDistintas = esTransferencia && !!origen && !!destino && origen.moneda !== destino.moneda;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!origen) { setError('Selecciona la banca.'); return; }
    if (!(num(monto) > 0)) { setError('El monto debe ser mayor a 0.'); return; }
    if (esTransferencia) {
      if (!destino) { setError('Selecciona la banca destino.'); return; }
      if (destino.id === origen.id) { setError('La banca destino debe ser distinta de la de origen.'); return; }
      if (monedasDistintas && !(num(montoDestino) > 0)) { setError('Indica cuánto recibe la banca destino.'); return; }
    }

    const input: EditarMovimientoInput = { llaveEdicion: llave.trim() || undefined };
    if (fecha !== movimiento.fecha.slice(0, 10)) input.fecha = fecha;
    if (descripcion.trim() !== movimiento.descripcion) input.descripcion = descripcion.trim();
    if (referencia.trim() !== movimiento.referencia) input.referencia = referencia.trim();
    if (bancaId !== movimiento.bancaOrigenId) input.bancaId = bancaId;
    if (esTransferencia && bancaDestinoId !== (movimiento.bancaDestinoId ?? '')) input.bancaDestinoId = bancaDestinoId;
    if (num(monto) !== movimiento.monto) input.monto = num(monto);
    if (origen.moneda !== movimiento.moneda) input.moneda = origen.moneda;
    if (esTransferencia && monedasDistintas && num(montoDestino) !== movimiento.montoDestino) input.montoDestino = num(montoDestino);
    // Si cambia una banca o el monto, el servidor necesita también el resto de la parte contable coherente.
    if (input.bancaId || input.bancaDestinoId || input.monto || input.moneda || input.montoDestino !== undefined) {
      input.bancaId = bancaId;
      input.monto = num(monto);
      input.moneda = origen.moneda;
      if (esTransferencia) {
        input.bancaDestinoId = bancaDestinoId;
        input.montoDestino = monedasDistintas ? num(montoDestino) : null;
      }
    }
    if (Object.keys(input).filter(k => k !== 'llaveEdicion').length === 0) { setError('No hay cambios que guardar.'); return; }

    setGuardando(true);
    const result = await editarMovimiento(movimiento.id, input);
    setGuardando(false);
    if ('error' in result) { setError(result.error); return; }
    onGuardado(result.movimiento, result.advertencia);
  };

  const inputClass = 'w-full px-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';
  const labelClass = 'block text-xs font-medium text-text-secondary mb-1';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-surface z-10">
          <h2 className="text-lg font-bold text-text-primary">Editar {ETIQUETA_TIPO[movimiento.tipo].toLowerCase()}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-text-muted hover:text-text-primary transition-colors"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className={labelClass}>{esTransferencia ? 'Banca origen' : movimiento.tipo === 'ingreso' ? 'Banca que recibe' : 'Banca de la que sale'}</label>
            <select value={bancaId} onChange={e => setBancaId(e.target.value)} className={inputClass}>
              {bancas.filter(b => !b.archivada || b.id === movimiento.bancaOrigenId).map(b => <option key={b.id} value={b.id}>{b.nombre} ({b.moneda})</option>)}
            </select>
          </div>

          {esTransferencia && (
            <div>
              <label className={labelClass}>Banca destino</label>
              <select value={bancaDestinoId} onChange={e => setBancaDestinoId(e.target.value)} className={inputClass}>
                <option value="">Selecciona banca…</option>
                {bancas.filter(b => b.id !== bancaId && (!b.archivada || b.id === movimiento.bancaDestinoId)).map(b => <option key={b.id} value={b.id}>{b.nombre} ({b.moneda})</option>)}
              </select>
            </div>
          )}

          <div className={monedasDistintas ? 'grid grid-cols-2 gap-3' : ''}>
            <div>
              <label className={labelClass}>Monto {origen && `(${origen.moneda})`}</label>
              <input type="text" inputMode="decimal" value={monto} onChange={e => setMonto(e.target.value)} className={inputClass} />
            </div>
            {monedasDistintas && (
              <div>
                <label className={labelClass}>Recibe destino ({destino?.moneda})</label>
                <input type="text" inputMode="decimal" value={montoDestino} onChange={e => setMontoDestino(e.target.value)} className={inputClass} />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Fecha</label>
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className={inputClass} required />
            </div>
            <div>
              <label className={labelClass}>Referencia</label>
              <input type="text" value={referencia} onChange={e => setReferencia(e.target.value)} maxLength={50} className={inputClass} />
            </div>
          </div>

          <div>
            <label className={labelClass}>Concepto</label>
            <input type="text" value={descripcion} onChange={e => setDescripcion(e.target.value)} maxLength={200} className={inputClass} />
          </div>

          <CampoLlaveEdicion entidadTipo="movimiento_banca" entidadId={movimiento.id} valor={llave} onChange={setLlave} />

          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3"><p className="text-red-600 text-sm">{error}</p></div>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">Cancelar</button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default EditarMovimientoModal;
