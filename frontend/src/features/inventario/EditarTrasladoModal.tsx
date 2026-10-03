import { useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { editarTraslado, type EditarTrasladoLineaInput } from '../../services/traslado-service';
import { netoLinea, validarLineasTraslado } from '../../lib/edicion-pesos-traslado';
import GenerarLlaveEdicion from '../../components/GenerarLlaveEdicion';
import HistorialEdiciones from '../../components/HistorialEdiciones';
import type { Traslado } from '@shared/types/index.js';

interface Props {
  traslado: Traslado;
  /** El servidor exige llave a este usuario (y no es superadmin). */
  requiereLlave: boolean;
  esSuperadmin: boolean;
  onClose: () => void;
  onGuardado: (t: Traslado) => void;
}

const inputClass = 'w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';
const pesoClass = 'w-24 px-2 py-1.5 bg-surface-alt border border-border rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-brand-400';
const labelClass = 'block text-xs font-medium text-text-secondary mb-1';

const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 3 }) : '—');
/** Texto vacío o no numérico = NaN, que la validación rechaza. */
const aNumero = (s: string): number => (s.trim() === '' ? NaN : Number(s));

interface LineaTexto { pesoBruto: string; tara: string; pesoRecibido: string }

/** Edita observaciones y pesos (enviado y, si ya fue recepcionado, recibido) de un traslado. */
function EditarTrasladoModal({ traslado: t, requiereLlave, esSuperadmin, onClose, onGuardado }: Props) {
  const completo = t.estado === 'completo';
  const [observaciones, setObservaciones] = useState(t.observaciones ?? '');
  const [lineas, setLineas] = useState<Record<string, LineaTexto>>(
    () => Object.fromEntries(t.materiales.map(m => [m.id, {
      pesoBruto: String(m.pesoBruto), tara: String(m.tara), pesoRecibido: m.pesoRecibido === null ? '' : String(m.pesoRecibido),
    }]))
  );
  const [llave, setLlave] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numericas = t.materiales.map(m => {
    const l = lineas[m.id];
    return { pesoBruto: aNumero(l.pesoBruto), tara: aNumero(l.tara), pesoRecibido: completo ? aNumero(l.pesoRecibido) : null };
  });
  const errorPesos = useMemo(
    () => validarLineasTraslado(numericas),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lineas]
  );

  const setCampo = (id: string, campo: keyof LineaTexto, valor: string) =>
    setLineas(prev => ({ ...prev, [id]: { ...prev[id], [campo]: valor } }));

  const construirCambios = () => {
    const lineasCambiadas = t.materiales.flatMap((m, i): EditarTrasladoLineaInput[] => {
      const n = numericas[i];
      const cambio: EditarTrasladoLineaInput = { id: m.id };
      if (n.pesoBruto !== m.pesoBruto) cambio.pesoBruto = n.pesoBruto;
      if (n.tara !== m.tara) cambio.tara = n.tara;
      if (completo && n.pesoRecibido !== m.pesoRecibido) cambio.pesoRecibido = n.pesoRecibido ?? undefined;
      return Object.keys(cambio).length > 1 ? [cambio] : [];
    });
    return {
      ...(observaciones.trim() !== (t.observaciones ?? '').trim() ? { observaciones: observaciones.trim() } : {}),
      ...(lineasCambiadas.length > 0 ? { lineas: lineasCambiadas } : {}),
    };
  };

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (errorPesos) { setError(errorPesos); return; }
    const cambios = construirCambios();
    if (Object.keys(cambios).length === 0) { setError('No hay cambios para guardar.'); return; }
    if (requiereLlave && !llave.trim()) { setError('Ingresa la llave de edición.'); return; }
    setGuardando(true);
    const res = await editarTraslado(t.id, { ...cambios, llaveEdicion: requiereLlave ? llave.trim() : undefined });
    setGuardando(false);
    if ('error' in res) { setError(res.error); return; }
    onGuardado(res.traslado);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 print:hidden">
      <form onSubmit={guardar} className="bg-surface rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Editar {t.codigo}</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary" title="Cerrar"><X size={18} /></button>
        </div>
        <p className="text-xs text-text-muted">
          Se pueden editar las observaciones y los pesos{completo ? ' enviados y recibidos' : ' enviados'}. Al cambiar un peso se recalcula
          el inventario del origen y del destino; si algún producto o lote quedara en negativo, o hay una toma física abierta,
          el sistema no guarda nada. Las fotos, los materiales y los almacenes no se modifican.
        </p>

        <div className="border border-border rounded-xl p-3 space-y-2">
          <div className="hidden sm:flex items-center gap-3 text-xs text-text-muted">
            <span className="flex-1">Material</span>
            <span className="w-24 text-right">Bruto</span>
            <span className="w-24 text-right">Tara</span>
            <span className="w-24 text-right">Neto</span>
            {completo && <span className="w-24 text-right">Recibido</span>}
          </div>
          {t.materiales.map((m, i) => (
            <div key={m.id} className="flex flex-wrap items-center gap-3">
              <span className="flex-1 min-w-[8rem] text-sm text-text-secondary truncate">
                {m.loteId ? `Lote ${m.nombreLote ?? ''}` : m.nombreProducto ?? 'Material'}
              </span>
              <input type="number" min="0" step="any" value={lineas[m.id].pesoBruto} onChange={e => setCampo(m.id, 'pesoBruto', e.target.value)} className={pesoClass} aria-label={`Peso bruto de ${m.nombreProducto ?? m.nombreLote ?? 'material'}`} />
              <input type="number" min="0" step="any" value={lineas[m.id].tara} onChange={e => setCampo(m.id, 'tara', e.target.value)} className={pesoClass} aria-label={`Tara de ${m.nombreProducto ?? m.nombreLote ?? 'material'}`} />
              <span className="w-24 text-right text-sm font-medium text-text-primary">{fmt(netoLinea(numericas[i].pesoBruto, numericas[i].tara))}</span>
              {completo && (
                <input type="number" min="0" step="any" value={lineas[m.id].pesoRecibido} onChange={e => setCampo(m.id, 'pesoRecibido', e.target.value)} className={pesoClass} aria-label={`Peso recibido de ${m.nombreProducto ?? m.nombreLote ?? 'material'}`} />
              )}
            </div>
          ))}
        </div>

        <div>
          <label className={labelClass}>Observaciones</label>
          <textarea value={observaciones} onChange={e => setObservaciones(e.target.value)} maxLength={2000} rows={2} className={`${inputClass} resize-none`} />
        </div>

        {errorPesos && <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs">{errorPesos}</p>}

        {requiereLlave && (
          <div>
            <label className={labelClass}>Llave de edición</label>
            <input
              type="text" value={llave} onChange={e => setLlave(e.target.value)} required autoComplete="off"
              className={`${inputClass} font-mono uppercase tracking-wider`}
              placeholder="Código entregado por el administrador"
            />
            <p className="text-xs text-text-muted mt-1">Pídesela a un administrador. Es de un solo uso.</p>
          </div>
        )}

        {esSuperadmin && <GenerarLlaveEdicion entidadTipo="traslado" entidadId={t.id} />}

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm text-text-secondary hover:bg-surface-alt transition-colors">
            Cancelar
          </button>
          <button type="submit" disabled={guardando || !!errorPesos} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
            {guardando ? <><Loader2 size={16} className="animate-spin" /> Guardando...</> : 'Guardar cambios'}
          </button>
        </div>

        <HistorialEdiciones entidadTipo="traslado" entidadId={t.id} />
      </form>
    </div>
  );
}

export default EditarTrasladoModal;
