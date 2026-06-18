import { useEffect, useState } from 'react';
import { Plus, Boxes, Loader2 } from 'lucide-react';
import { obtenerLotes, crearLote, actualizarLote } from '../../services/lote-service';
import { useAuth } from '../../hooks/use-auth';
import { useToast } from '../../hooks/use-toast';
import type { Lote } from '@shared/types/index.js';

function LotesPage() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const puedeCrear = tienePermiso('productos', 'crear');
  const puedeEditar = tienePermiso('productos', 'editar');

  const [lotes, setLotes] = useState<Lote[]>([]);
  const [cargando, setCargando] = useState(true);
  const [nombre, setNombre] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = () => {
    setCargando(true);
    obtenerLotes().then(setLotes).finally(() => setCargando(false));
  };

  useEffect(() => { cargar(); }, []);

  const handleCrear = async (e: React.FormEvent) => {
    e.preventDefault();
    const limpio = nombre.trim();
    if (!limpio) return;
    setGuardando(true);
    const result = await crearLote(limpio);
    setGuardando(false);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`Lote "${result.lote.nombre}" creado.`);
    setNombre('');
    cargar();
  };

  const toggleActivo = async (l: Lote) => {
    const result = await actualizarLote(l.id, { activo: !l.activo });
    if ('error' in result) { toast.errorMsg(result.error); return; }
    cargar();
  };

  const inputClass = "px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Lotes</h1>
        <p className="text-sm text-text-secondary mt-1">
          Destinos de inventario para el material pesado. Junto con MPP (Material Por Procesar),
          definen dónde se acumula el stock de cada material.
        </p>
      </div>

      {puedeCrear && (
        <form onSubmit={handleCrear} className="flex items-end gap-2 mb-5">
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
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
          >
            {guardando ? <Loader2 size={16} className="animate-spin" /> : <Plus size={18} />}
            Agregar
          </button>
        </form>
      )}

      {cargando ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
        </div>
      ) : lotes.length === 0 ? (
        <p className="text-center text-text-muted py-12 text-sm">No hay lotes todavía.</p>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          {lotes.map(l => (
            <div key={l.id} className="flex items-center gap-4 px-5 py-3.5 border-b border-border last:border-b-0">
              <div className="w-9 h-9 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 shrink-0">
                <Boxes size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-text-primary text-sm truncate">{l.nombre}</h3>
                  {!l.activo && (
                    <span className="px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded-full shrink-0">Inactivo</span>
                  )}
                </div>
              </div>
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
          ))}
        </div>
      )}
    </div>
  );
}

export default LotesPage;
