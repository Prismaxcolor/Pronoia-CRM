import { useEffect, useState } from 'react';
import { Plus, Boxes, Loader2, Pencil } from 'lucide-react';
import { obtenerLotes, crearLote, actualizarLote } from '../../services/lote-service';
import { subirFotoLote } from '../../services/storage-service';
import { fotoLocalDeFile, subirFotosLocal, type FotoLocal } from '../../lib/foto-picker';
import FotoMultiplePicker from '../../components/FotoMultiplePicker';
import LoteFormModal from './LoteFormModal';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import type { Lote } from '@shared/types/index.js';

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function LotesPanel() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const puedeCrear = tienePermiso('productos', 'crear');
  const puedeEditar = tienePermiso('productos', 'editar');

  const [lotes, setLotes] = useState<Lote[]>([]);
  const [cargando, setCargando] = useState(true);
  const [nombre, setNombre] = useState('');
  const [fotosNuevoLote, setFotosNuevoLote] = useState<FotoLocal[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [loteEditando, setLoteEditando] = useState<Lote | null>(null);

  const recargar = () => obtenerLotes().then(setLotes).finally(() => setCargando(false));
  const cargar = () => { setCargando(true); recargar(); };

  useEffect(() => { recargar(); }, []);

  const handleCrear = async (e: React.FormEvent) => {
    e.preventDefault();
    const limpio = nombre.trim();
    if (!limpio) return;
    setGuardando(true);
    const urls = await subirFotosLocal(fotosNuevoLote, subirFotoLote);
    if (!urls) { toast.errorMsg('Error al subir una de las fotos.'); setGuardando(false); return; }
    const result = await crearLote(limpio, urls);
    setGuardando(false);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`Lote "${result.lote.nombre}" creado.`);
    setNombre('');
    setFotosNuevoLote([]);
    cargar();
  };

  const toggleActivo = async (l: Lote) => {
    const result = await actualizarLote(l.id, { activo: !l.activo });
    if ('error' in result) { toast.errorMsg(result.error); return; }
    cargar();
  };

  const inputClass = "px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";

  if (cargando) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-text-primary">Lotes</h2>
        <p className="text-sm text-text-secondary mt-1">
          Destinos de inventario para el material pesado. Definen dónde se acumula el
          stock de cada material.
        </p>
      </div>

      {puedeCrear && (
        <form onSubmit={handleCrear} className="flex flex-col gap-3 mb-5">
          <div className="flex flex-col sm:flex-row sm:items-end gap-2">
            <div className="flex-1">
              <label className="block text-xs font-medium text-text-secondary mb-1">Nuevo lote</label>
              <input
                type="text"
                value={nombre}
                onChange={e => setNombre(e.target.value)}
                className={`${inputClass} w-full`}
                placeholder="Ej. Lote 1"
              />
            </div>
            <button
              type="submit"
              disabled={guardando || !nombre.trim()}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
            >
              {guardando ? <Loader2 size={16} className="animate-spin" /> : <Plus size={18} />}
              Agregar
            </button>
          </div>
          <FotoMultiplePicker
            fotos={fotosNuevoLote}
            onAgregar={files => setFotosNuevoLote(prev => [...prev, ...files.map(fotoLocalDeFile)])}
            onQuitar={idx => setFotosNuevoLote(prev => prev.filter((_, i) => i !== idx))}
            label="Fotos del lote"
          />
        </form>
      )}

      {lotes.length === 0 ? (
        <p className="text-center text-text-muted py-12 text-sm">No hay lotes todavía.</p>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          {lotes.map(l => (
            <div key={l.id} className="px-4 sm:px-5 py-3.5 border-b border-border last:border-b-0">
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 shrink-0">
                  <Boxes size={16} />
                </div>
                <div className="flex-1 min-w-[8rem]">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-text-primary text-sm truncate">{l.nombre}</h3>
                    {!l.activo && (
                      <span className="px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded-full shrink-0">Inactivo</span>
                    )}
                  </div>
                  <p className={`text-xs mt-0.5 ${l.stockKg < 0 ? 'text-red-600' : 'text-text-muted'}`}>
                    {fmt(l.stockKg)} kg
                  </p>
                </div>
                {puedeEditar && (
                  <button
                    type="button"
                    onClick={() => setLoteEditando(l)}
                    className="p-1.5 rounded-md hover:bg-surface-alt text-text-muted hover:text-brand-600 transition-colors shrink-0"
                    title="Editar lote"
                  >
                    <Pencil size={15} />
                  </button>
                )}
                {puedeEditar && (
                  <button
                    type="button"
                    onClick={() => toggleActivo(l)}
                    className="text-xs font-medium text-text-muted hover:text-brand-600 transition-colors"
                  >
                    {l.activo ? 'Desactivar' : 'Reactivar'}
                  </button>
                )}
              </div>
              {l.stockPorAlmacen.length > 0 && (
                // Cada almacén tiene SU PROPIA composición — no es la misma
                // en todos: cada uno acumula sus propias compras y
                // transformaciones por separado (ver
                // docs/migration_lote_composicion_por_almacen.sql).
                <div className="mt-2 pl-12 space-y-1.5">
                  {l.stockPorAlmacen.map(s => (
                    <div key={s.almacenId} className="flex flex-wrap items-center gap-1">
                      <span className="text-[11px] bg-surface-alt border border-border rounded-full px-2 py-0.5 text-text-secondary font-medium">
                        {s.almacenNombre}: {fmt(s.stockKg)} kg
                      </span>
                      {s.composicion.map(c => (
                        <span key={c.item} className="text-[11px] bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
                          {c.item}: {c.porcentaje}%
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {loteEditando && (
        <LoteFormModal
          lote={loteEditando}
          onClose={() => setLoteEditando(null)}
          onGuardado={() => { setLoteEditando(null); cargar(); }}
        />
      )}
    </div>
  );
}

export default LotesPanel;
