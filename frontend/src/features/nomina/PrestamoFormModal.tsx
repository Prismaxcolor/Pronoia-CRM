import { useEffect, useState } from 'react';
import Modal from '../../components/Modal';
import { X } from 'lucide-react';
import { obtenerBancas } from '../../services/banca-service';
import { crearPrestamo, obtenerTrabajadores } from '../../services/nomina-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { useComisionDisponible } from '../cochinito/useComisionDisponible';
import type { Banca } from '../../../../shared/types/banca.js';
import { hoyNegocio } from '../../lib/fecha-negocio';
import {
  ETIQUETA_TIPO_PRESTAMO, ETIQUETA_TIPO_TRABAJADOR, TIPOS_PRESTAMO, formatearNumeroPrestamo, nombreCompleto, type TipoPrestamo, type Trabajador,
} from '@shared/types/nomina';
import { leerNumero } from './nomina-editor';
import DesembolsoCampos from './DesembolsoCampos';
import { MENSAJE_COMPROBANTE_NO_SUBIDO, useComprobantesPago } from './useComprobantesPago';
import { construirDesembolso, cuentasDeDesembolso, desembolsoVacio, validarDesembolso } from './nomina-desembolso';

interface Props {
  onClose: () => void;
  onCreado: () => void;
}

const inputClass = 'w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';
const labelClass = 'block text-xs font-medium text-text-secondary mb-1';

function PrestamoFormModal({ onClose, onCreado }: Props) {
  const toast = useToast();
  const { tienePermiso } = useAuth();
  // Registrar el pago mueve dinero del Wallet: hace falta poder crear movimientos.
  const puedePagar = tienePermiso('cochinito', 'crear');
  const comision = useComisionDisponible(puedePagar);
  const comprobantes = useComprobantesPago();
  const [bancas, setBancas] = useState<Banca[] | null>(null);
  const [conPago, setConPago] = useState(puedePagar);
  const [desembolso, setDesembolso] = useState(() => desembolsoVacio(hoyNegocio()));
  const [trabajadores, setTrabajadores] = useState<Trabajador[]>([]);
  const [trabajadorId, setTrabajadorId] = useState('');
  // Sin valor por defecto: hay que elegir si es préstamo o adelanto a propósito.
  const [tipo, setTipo] = useState<TipoPrestamo | ''>('');
  const [monto, setMonto] = useState('');
  const [cuota, setCuota] = useState('');
  const [fecha, setFecha] = useState(hoyNegocio());
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void obtenerTrabajadores().then(r => {
      if (!vivo) return;
      if ('error' in r) setError(r.error);
      else setTrabajadores(r.trabajadores);
    });
    if (puedePagar) void obtenerBancas().then(lista => { if (vivo) setBancas(lista); });
    return () => { vivo = false; };
  }, [puedePagar]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const montoUsd = leerNumero(monto);
    const cuotaSemanalUsd = leerNumero(cuota);
    if (!trabajadorId) { setError('Elige al trabajador.'); return; }
    if (!tipo) { setError('Elige si es un préstamo o un adelanto.'); return; }
    if (montoUsd === null || montoUsd <= 0) { setError('El monto debe ser mayor a 0.'); return; }
    if (cuota.trim() && (cuotaSemanalUsd === null || cuotaSemanalUsd <= 0 || cuotaSemanalUsd > montoUsd)) {
      setError('La cuota semanal debe ser mayor a 0 y no puede superar el monto.');
      return;
    }
    const cuentas = cuentasDeDesembolso(bancas ?? []);
    const problemaPago = conPago ? validarDesembolso(desembolso, montoUsd, cuentas, comision.disponible) : null;
    if (problemaPago) { setError(problemaPago); return; }
    setGuardando(true);
    const urls = conPago ? await comprobantes.subir() : [];
    if (!urls) { setGuardando(false); setError(MENSAJE_COMPROBANTE_NO_SUBIDO); return; }
    const r = await crearPrestamo({
      trabajadorId, tipo, montoUsd, cuotaSemanalUsd, fecha, nota: nota.trim() || null,
      ...(conPago ? { desembolso: construirDesembolso(desembolso, cuentas, comision.disponible, urls) } : {}),
    });
    setGuardando(false);
    if ('error' in r) { setError(r.error); return; }
    toast.exito(`${ETIQUETA_TIPO_PRESTAMO[r.prestamo.tipo]} ${formatearNumeroPrestamo(r.prestamo.numero)} registrado${conPago && !r.advertencia ? ' y pagado desde el Wallet' : ''}.`);
    if (r.advertencia) toast.errorMsg(r.advertencia);
    onCreado();
  };

  return (
    <Modal onClose={onClose} bloqueado={guardando} tituloId="prestamo-titulo">
      <div className="flex items-center justify-between p-5 border-b border-border">
        <h2 id="prestamo-titulo" className="text-lg font-bold text-text-primary">Nuevo préstamo o adelanto</h2>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="text-text-muted hover:text-text-primary transition-colors"><X size={20} /></button>
      </div>
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <div>
          <label htmlFor="pre-trabajador" className={labelClass}>Trabajador *</label>
          <select id="pre-trabajador" value={trabajadorId} onChange={e => setTrabajadorId(e.target.value)} className={inputClass}>
            <option value="">Elige…</option>
            {trabajadores.map(t => <option key={t.id} value={t.id}>{nombreCompleto(t)} · {ETIQUETA_TIPO_TRABAJADOR[t.tipo]}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="pre-tipo" className={labelClass}>Tipo *</label>
            <select id="pre-tipo" value={tipo} onChange={e => setTipo(e.target.value as TipoPrestamo | '')} className={inputClass}>
              <option value="">Elige…</option>
              {TIPOS_PRESTAMO.map(t => <option key={t} value={t}>{ETIQUETA_TIPO_PRESTAMO[t]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="pre-fecha" className={labelClass}>Fecha *</label>
            <input id="pre-fecha" type="date" required value={fecha} onChange={e => setFecha(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="pre-monto" className={labelClass}>Monto (USD) *</label>
            <input id="pre-monto" inputMode="decimal" value={monto} onChange={e => setMonto(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="pre-cuota" className={labelClass}>Cuota por semana (USD)</label>
            <input id="pre-cuota" inputMode="decimal" value={cuota} onChange={e => setCuota(e.target.value)} className={inputClass} aria-describedby="pre-cuota-ayuda" />
          </div>
        </div>
        <p id="pre-cuota-ayuda" className="text-xs text-text-muted">
          Con cuota semanal, cada nómina propone descontarla sola (tú puedes cambiarla). Sin cuota, la descuentas a mano cuando quieras.
        </p>
        <div>
          <label htmlFor="pre-nota" className={labelClass}>Nota</label>
          <textarea id="pre-nota" rows={2} maxLength={300} value={nota} onChange={e => setNota(e.target.value)} className={inputClass} />
        </div>
        {puedePagar && (
          <fieldset className="space-y-3 rounded-xl border border-border p-3">
            <legend className="px-1 text-sm font-semibold text-text-primary">Pago desde el Wallet</legend>
            <label className="flex items-center gap-2 text-sm text-text-primary">
              <input type="checkbox" checked={conPago} onChange={e => setConPago(e.target.checked)} />
              Registrar ahora el pago (sale dinero de una cuenta)
            </label>
            {conPago && (bancas === null ? <p role="status" className="text-sm text-text-muted">Cargando cuentas…</p> : (
              <DesembolsoCampos
                montoUsd={leerNumero(monto)} bancas={bancas} estado={desembolso} onCambiar={setDesembolso} comisionDisponible={comision.disponible}
                estadoComision={comision.estado} onReintentarComision={comision.reintentar} comprobantes={comprobantes}
              />
            ))}
            {!conPago && <p className="text-xs text-text-muted">El préstamo quedará sin pago: podrás registrarlo después con «Registrar pago».</p>}
          </fieldset>
        )}
        {error && <p role="alert" className="text-red-500 text-sm">{error}</p>}
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">Cancelar</button>
          <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
            {guardando ? 'Guardando...' : 'Registrar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default PrestamoFormModal;
