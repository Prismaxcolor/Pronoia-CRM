import { useEffect, useState } from 'react';
import { ArrowRight, Loader2, Recycle, CheckCircle2, Clock, X } from 'lucide-react';
import {
  obtenerTransformaciones,
  crearTransformacion,
  borrarTransformacion,
} from '../../services/transformacion-service';
import { obtenerLotes } from '../../services/lote-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import CompletarTransformacionModal from './CompletarTransformacionModal';
import type { Transformacion, Lote } from '@shared/types/index.js';

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

function TransformacionesPage() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const puedeCrear = tienePermiso('transformaciones', 'crear');
  const puedeEliminar = tienePermiso('transformaciones', 'eliminar');

  const [lotes, setLotes] = useState<Lote[]>([]);
  const [transformaciones, setTransformaciones] = useState<Transformacion[]>([]);
  const [cargando, setCargando] = useState(true);

  const [loteOrigenId, setLoteOrigenId] = useState('');
  const [pesoBruto, setPesoBruto] = useState('');
  const [tara, setTara] = useState('');
  const [fecha, setFecha] = useState(hoyISO());
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [completando, setCompletando] = useState<Transformacion | null>(null);

  const cargarDatos = () => {
    obtenerLotes().then(lista => setLotes(lista.filter(l => l.activo)));
    obtenerTransformaciones().then(lista => {
      setTransformaciones(lista);
      setCargando(false);
    });
  };

  useEffect(cargarDatos, []);

  const loteOrigen = lotes.find(l => l.id === loteOrigenId);
  const neto = (Number(pesoBruto) || 0) - (Number(tara) || 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!loteOrigen) { setError('Elige el lote de origen.'); return; }
    if (neto <= 0) { setError('El peso neto debe ser mayor a 0.'); return; }
    if (neto > loteOrigen.stockKg + 0.01) {
      setError(`Solo hay ${fmt(loteOrigen.stockKg)} kg disponibles en ${loteOrigen.nombre}.`);
      return;
    }

    setGuardando(true);
    const result = await crearTransformacion({
      loteOrigenId,
      pesoBruto: Number(pesoBruto) || 0,
      tara: Number(tara) || 0,
      fecha,
      notas: notas.trim() || null,
    });
    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    toast.exito('Retiro registrado. Complétalo cuando peses las salidas.');
    setLoteOrigenId('');
    setPesoBruto('');
    setTara('');
    setFecha(hoyISO());
    setNotas('');
    cargarDatos();
  };

  const cancelar = async (t: Transformacion) => {
    if (!confirm(`¿Cancelar el retiro de ${fmt(t.pesoNeto)} kg de ${t.nombreLoteOrigen}?`)) return;
    const result = await borrarTransformacion(t.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito('Retiro cancelado.');
    cargarDatos();
  };

  const pendientes = transformaciones.filter(t => t.estado === 'bruto');
  const completas = transformaciones.filter(t => t.estado === 'completa');

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Transformaciones</h1>
        <p className="text-sm text-text-secondary mt-1">
          Retira material de un lote mezclado (MPP, BGPP...), procésalo, y pesa a dónde salió.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Registrar retiro */}
        {puedeCrear ? (
          <div className="bg-surface rounded-xl border border-border p-5 h-fit">
            <h2 className="text-sm font-semibold text-text-secondary mb-4">Registrar retiro</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className={labelClass}>Lote de origen *</label>
                <select required value={loteOrigenId} onChange={e => setLoteOrigenId(e.target.value)} className={inputClass}>
                  <option value="" disabled>-Selecciona-</option>
                  {lotes.map(l => (
                    <option key={l.id} value={l.id}>{l.nombre} — {fmt(l.stockKg)} kg</option>
                  ))}
                </select>
                {loteOrigen && (
                  <p className="text-xs text-text-muted mt-1">
                    Disponible: <span className={loteOrigen.stockKg < 0 ? 'text-red-600 font-medium' : 'font-medium'}>{fmt(loteOrigen.stockKg)} kg</span>
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Peso bruto (kg) *</label>
                  <input type="number" step="0.001" min="0.01" required value={pesoBruto} onChange={e => setPesoBruto(e.target.value)} className={inputClass} placeholder="0.00" />
                </div>
                <div>
                  <label className={labelClass}>Tara (kg)</label>
                  <input type="number" step="0.01" min="0" value={tara} onChange={e => setTara(e.target.value)} className={inputClass} placeholder="0.00" />
                </div>
              </div>

              <p className="text-xs text-text-muted">Neto a retirar: <span className="font-semibold text-text-primary">{fmt(neto)} kg</span></p>

              <div>
                <label className={labelClass}>Fecha</label>
                <input type="date" required value={fecha} onChange={e => setFecha(e.target.value)} className={inputClass} />
              </div>

              <div>
                <label className={labelClass}>Notas <span className="text-text-muted">(opcional)</span></label>
                <textarea value={notas} onChange={e => setNotas(e.target.value)} className={`${inputClass} resize-none`} rows={2} />
              </div>

              {error && <p className="text-red-500 text-sm">{error}</p>}

              <button type="submit" disabled={guardando} className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
                {guardando ? <><Loader2 size={16} className="animate-spin" /> Registrando...</> : <>Registrar retiro <ArrowRight size={16} /></>}
              </button>
            </form>
          </div>
        ) : (
          <p className="text-text-muted text-sm">No tienes permiso para registrar transformaciones.</p>
        )}

        {/* Listas */}
        <div className="space-y-6">
          {pendientes.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-text-secondary mb-3">Pendientes de completar</h2>
              <div className="space-y-2">
                {pendientes.map(t => (
                  <div key={t.id} className="bg-surface rounded-xl border border-amber-200 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600 shrink-0">
                        <Clock size={14} />
                      </div>
                      <span className="text-sm font-medium text-text-primary">{fmt(t.pesoNeto)} kg de {t.nombreLoteOrigen}</span>
                      <span className="text-xs text-text-muted ml-auto">{t.fecha}</span>
                    </div>
                    <div className="flex gap-2 pl-9">
                      <button
                        type="button"
                        onClick={() => setCompletando(t)}
                        className="text-xs font-medium text-brand-600 hover:text-brand-700"
                      >
                        Completar →
                      </button>
                      {puedeEliminar && (
                        <button
                          type="button"
                          onClick={() => cancelar(t)}
                          className="text-xs font-medium text-text-muted hover:text-red-600 flex items-center gap-0.5"
                        >
                          <X size={12} /> Cancelar
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h2 className="text-sm font-semibold text-text-secondary mb-3">Historial</h2>
            {cargando ? (
              <div className="flex justify-center py-10">
                <Loader2 size={20} className="animate-spin text-text-muted" />
              </div>
            ) : completas.length === 0 ? (
              <div className="bg-surface rounded-xl border border-border">
                <p className="text-center text-text-muted py-10 text-sm">Aún no hay transformaciones completadas.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {completas.map(t => (
                  <div key={t.id} className="bg-surface rounded-xl border border-border p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-7 h-7 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 shrink-0">
                        <Recycle size={14} />
                      </div>
                      <span className="text-sm font-medium text-text-primary">{fmt(t.pesoNeto)} kg de {t.nombreLoteOrigen}</span>
                      <CheckCircle2 size={13} className="text-green-600 shrink-0" />
                      <span className="text-xs text-text-muted ml-auto">{t.fecha}</span>
                    </div>
                    <div className="pl-9 text-xs text-text-secondary space-y-0.5">
                      {t.salidas.map(s => (
                        <div key={s.id} className="flex justify-between">
                          <span>→ {s.nombreLoteDestino}</span>
                          <span className="font-medium">{fmt(s.pesoNeto)} kg</span>
                        </div>
                      ))}
                      <div className="flex justify-between text-text-muted pt-1 border-t border-border mt-1">
                        <span>Merma</span>
                        <span>{fmt(t.pesoNeto - t.salidas.reduce((acc, s) => acc + s.pesoNeto, 0))} kg</span>
                      </div>
                    </div>
                    {t.entradaDetalle.length > 0 && (
                      <details className="pl-9 mt-2">
                        <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary">
                          Composición retirada ({t.entradaDetalle.length} material{t.entradaDetalle.length === 1 ? '' : 'es'})
                        </summary>
                        <div className="text-xs text-text-muted space-y-0.5 mt-1">
                          {t.entradaDetalle.map(d => (
                            <div key={d.productoId} className="flex justify-between">
                              <span>{d.nombreProducto}</span>
                              <span>{fmt(d.pesoKg)} kg</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {completando && (
        <CompletarTransformacionModal
          transformacion={completando}
          lotes={lotes}
          onClose={() => setCompletando(null)}
          onCompletada={() => { setCompletando(null); cargarDatos(); }}
        />
      )}
    </div>
  );
}

export default TransformacionesPage;
