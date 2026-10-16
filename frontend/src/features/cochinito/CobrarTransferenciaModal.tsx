import { useState } from 'react';
import { X } from 'lucide-react';
import { formatearNumero } from '../../components/ui';
import FotoMultiplePicker from '../../components/FotoMultiplePicker';
import { useToast } from '../../hooks/use-toast-context';
import { completarTransferenciaMesa } from '../../services/transferencia-mesa-service';
import { subirComprobantePago } from '../../services/storage-service';
import { fotoLocalDeFile, subirFotosLocal, type FotoLocal } from '../../lib/foto-picker';
import { filtrarComprobantes } from '../../lib/comprobante-imagen';
import type { Banca, Movimiento } from '@shared/types/index.js';
import { montoCobradoMesa, montoPendienteMesa, validarCobroMesa } from './cobro-mesa';
import { montoQueRecibeElDestino } from './detalle-movimiento';

interface Props {
  movimiento: Movimiento;
  bancaDestino: Banca | undefined;
  onClose: () => void;
  /** El cobro quedó registrado (total o parcial): quien abre recarga sus datos. */
  onCobrado: () => void;
}

const inputClass = 'w-full px-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';
const simbolo = (moneda: string | undefined): string => (moneda === 'USD' ? 'USD' : moneda === 'VES' ? 'Bs' : moneda ?? '');

function Fila({ etiqueta, valor, fuerte }: { etiqueta: string; valor: string; fuerte?: boolean }) {
  return (
    <>
      <dt className="text-text-secondary">{etiqueta}</dt>
      <dd className={`text-right tabular-nums ${fuerte ? 'font-semibold text-text-primary' : ''}`}>{valor}</dd>
    </>
  );
}

/**
 * Completa (cobra) una transferencia con mesa de cambio: todo lo pendiente o solo la parte que el cambista abonó,
 * con una foto opcional del comprobante. Lo que queda pendiente se cobra después con este mismo formulario.
 */
function CobrarTransferenciaModal({ movimiento, bancaDestino, onClose, onCobrado }: Props) {
  const toast = useToast();
  const [parcial, setParcial] = useState(false);
  const [texto, setTexto] = useState('');
  const [fotos, setFotos] = useState<FotoLocal[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const s = simbolo(bancaDestino?.moneda ?? movimiento.moneda);
  const fmt = (n: number) => `${s} ${formatearNumero(n, 2)}`;
  const neto = montoQueRecibeElDestino(movimiento) ?? 0;
  const cobrado = montoCobradoMesa(movimiento) ?? 0;
  const pendiente = montoPendienteMesa(movimiento) ?? 0;
  const validacion = validarCobroMesa({ parcial, texto, pendiente });

  const agregarFotos = (files: File[]) => {
    const { validos, errores } = filtrarComprobantes(files, fotos.length);
    if (errores.length > 0) setError(errores[0]);
    setFotos(prev => [...prev, ...validos.map(fotoLocalDeFile)]);
  };

  const confirmar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (guardando) return;
    setError(null);
    if (!validacion.ok) { setError(validacion.error); return; }
    setGuardando(true);
    const urls = await subirFotosLocal(fotos, subirComprobantePago);
    if (!urls) {
      setGuardando(false);
      setError('No se pudo subir la foto. Prueba de nuevo o cobra sin ella.');
      return;
    }
    const r = await completarTransferenciaMesa(movimiento.id, {
      montoCobrado: validacion.montoCobrado, pendienteEsperado: pendiente, comprobantes: urls,
    });
    setGuardando(false);
    if ('error' in r) { setError(r.error); return; }
    if (r.advertencia) toast.errorMsg(r.advertencia);
    if (r.yaCompletada) toast.exito('La transferencia ya estaba completada.');
    else if (r.completada) toast.exito('Transferencia completada: el saldo ya está en la cuenta destino.');
    else toast.exito(`Cobro parcial registrado. Quedan ${fmt(r.montoPendiente)} por cobrar.`);
    onCobrado();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div role="dialog" aria-modal="true" aria-label="Completar transferencia" className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-bold text-text-primary">{cobrado > 0 ? 'Cobrar el resto' : 'Completar transferencia'}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-text-muted hover:text-text-primary transition-colors"><X size={20} /></button>
        </div>
        <form onSubmit={e => void confirmar(e)} className="p-5 space-y-4">
          <p className="text-sm text-text-secondary">
            Se acreditará en {bancaDestino?.nombre ?? 'la cuenta destino'} lo que el cambista entregó (ya descontada la comisión) y se saldará esa parte de su deuda.
            Hazlo solo cuando ya recibiste el dinero.
          </p>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm" aria-label="Resumen del cobro">
            <Fila etiqueta="Debe entregar el cambista (neto)" valor={fmt(neto)} />
            <Fila etiqueta="Ya cobrado" valor={fmt(cobrado)} />
            <Fila etiqueta="Pendiente por cobrar" valor={fmt(pendiente)} fuerte />
          </dl>

          <fieldset className="space-y-2">
            <legend className="sr-only">Cuánto cobraste</legend>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
              <input type="radio" name="cobro" checked={!parcial} onChange={() => setParcial(false)} className="h-4 w-4 accent-brand-600" />
              Cobrar todo lo pendiente ({fmt(pendiente)})
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
              <input type="radio" name="cobro" checked={parcial} onChange={() => setParcial(true)} className="h-4 w-4 accent-brand-600" />
              Cobro parcial: el cambista solo abonó una parte
            </label>
          </fieldset>

          {parcial && (
            <div>
              <label htmlFor="cobro-monto" className="block text-xs font-medium text-text-secondary mb-1">Monto cobrado ({s}) *</label>
              <input id="cobro-monto" inputMode="decimal" autoComplete="off" value={texto} onChange={e => setTexto(e.target.value)} className={inputClass} placeholder="0,00" />
              {validacion.ok && validacion.montoCobrado !== null && (
                <p className="mt-1 text-xs text-text-muted">
                  {validacion.quedaPendiente > 0 ? `Quedarán ${fmt(validacion.quedaPendiente)} por cobrar después.` : 'Con este monto la transferencia queda completada.'}
                </p>
              )}
            </div>
          )}

          <FotoMultiplePicker fotos={fotos} onAgregar={agregarFotos} onQuitar={i => setFotos(prev => prev.filter((_, j) => j !== i))} label="Foto del comprobante (opcional)" />

          {error && <p role="alert" className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} disabled={guardando} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">Cancelar</button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? 'Guardando...' : parcial ? 'Registrar cobro parcial' : 'Completar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CobrarTransferenciaModal;
