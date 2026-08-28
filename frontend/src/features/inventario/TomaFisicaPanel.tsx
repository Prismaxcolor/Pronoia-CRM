import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ClipboardList } from 'lucide-react';
import { obtenerTomasFisicas, crearTomaFisica } from '../../services/toma-fisica-service';
import { obtenerAlmacenes } from '../../services/almacen-service';
import { obtenerTiposMaterial } from '../../services/tipo-material-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import type { TomaFisicaInventario, Almacen, TipoMaterial } from '@shared/types/index.js';

function fmtFecha(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function NuevaTomaFisicaModal({
  almacenes,
  categorias,
  onClose,
  onCreada,
}: {
  almacenes: Almacen[];
  categorias: TipoMaterial[];
  onClose: () => void;
  onCreada: (t: TomaFisicaInventario) => void;
}) {
  const toast = useToast();
  const [almacenId, setAlmacenId] = useState(almacenes.find(a => a.activo)?.id ?? '');
  const [categoriaIds, setCategoriaIds] = useState<string[]>([]);
  const [descripcion, setDescripcion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleCategoria = (id: string) =>
    setCategoriaIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!almacenId) { setError('Elige un almacén.'); return; }
    if (categoriaIds.length === 0) { setError('Elige al menos una categoría a inventariar.'); return; }

    setGuardando(true);
    const result = await crearTomaFisica({ almacenId, categoriaIds, descripcion: descripcion.trim() || null });
    setGuardando(false);
    if ('error' in result) { setError(result.error); return; }
    toast.exito(`${result.tomaFisica.codigo} creada — el almacén queda bloqueado hasta culminarla.`);
    onCreada(result.tomaFisica);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md">
        <div className="p-5 border-b border-border">
          <h2 className="text-lg font-bold text-text-primary">Nueva toma física de inventario</h2>
          <p className="text-sm text-text-secondary mt-1">
            Mientras esté abierta, el almacén elegido queda bloqueado para pesajes, traslados y facturación.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Almacén *</label>
            <select value={almacenId} onChange={e => setAlmacenId(e.target.value)} className={inputClass}>
              {almacenes.filter(a => a.activo).map(a => (
                <option key={a.id} value={a.id}>{a.nombre}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Categorías a inventariar *</label>
            <div className="border border-border rounded-lg divide-y divide-border max-h-40 overflow-y-auto">
              {categorias.map(c => (
                <label key={c.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface-alt transition-colors">
                  <input
                    type="checkbox"
                    checked={categoriaIds.includes(c.id)}
                    onChange={() => toggleCategoria(c.id)}
                    className="w-4 h-4 accent-brand-600"
                  />
                  <span className="text-sm text-text-primary">{c.nombre}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Descripción</label>
            <input
              type="text" maxLength={200}
              value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              className={inputClass}
              placeholder="Ej. Cierre de mes agosto 2026 — No Ferroso"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? 'Creando…' : 'Crear e iniciar conteo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TomaFisicaPanel() {
  const navigate = useNavigate();
  const { tienePermiso } = useAuth();
  const puedeCrear = tienePermiso('toma_fisica', 'crear');

  const [tomasFisicas, setTomasFisicas] = useState<TomaFisicaInventario[]>([]);
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [categorias, setCategorias] = useState<TipoMaterial[]>([]);
  const [cargando, setCargando] = useState(true);
  const [modalAbierto, setModalAbierto] = useState(false);

  const cargar = () => {
    setCargando(true);
    obtenerTomasFisicas().then(setTomasFisicas).finally(() => setCargando(false));
  };

  useEffect(() => {
    cargar();
    obtenerAlmacenes().then(setAlmacenes);
    obtenerTiposMaterial().then(setCategorias);
  }, []);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Tomas físicas de inventario</h2>
          <p className="text-sm text-text-secondary mt-1">
            Conteo físico que reconcilia el stock teórico contra lo realmente contado. Mientras
            una esté abierta, el almacén queda bloqueado para nuevos movimientos.
          </p>
        </div>
        {puedeCrear && (
          <button
            type="button"
            onClick={() => setModalAbierto(true)}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors shrink-0"
          >
            <Plus size={18} />
            Nueva toma física
          </button>
        )}
      </div>

      {cargando ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
        </div>
      ) : tomasFisicas.length === 0 ? (
        <p className="text-center text-text-muted py-12 text-sm">No hay tomas físicas registradas todavía.</p>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          {tomasFisicas.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => navigate(`/inventario/toma-fisica/${t.id}`)}
              className="w-full flex items-center gap-4 px-5 py-3.5 border-b border-border last:border-b-0 hover:bg-surface-alt transition-colors text-left"
            >
              <div className="w-9 h-9 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 shrink-0">
                <ClipboardList size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-text-primary text-sm">{t.codigo}</h3>
                  <span className={`px-2 py-0.5 rounded-full text-xs shrink-0 ${t.estado === 'abierta' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                    {t.estado === 'abierta' ? 'Abierta' : 'Cerrada'}
                  </span>
                </div>
                <p className="text-xs text-text-muted truncate">
                  {t.almacenNombre} · {t.categoriaNombres.join(', ')}
                  {t.descripcion ? ` · ${t.descripcion}` : ''}
                </p>
              </div>
              <span className="text-xs text-text-muted shrink-0">
                {t.estado === 'abierta' ? `Abierta ${fmtFecha(t.abiertaEn)}` : `Cerrada ${fmtFecha(t.cerradaEn)}`}
              </span>
            </button>
          ))}
        </div>
      )}

      {modalAbierto && (
        <NuevaTomaFisicaModal
          almacenes={almacenes}
          categorias={categorias}
          onClose={() => setModalAbierto(false)}
          onCreada={t => { setModalAbierto(false); cargar(); navigate(`/inventario/toma-fisica/${t.id}`); }}
        />
      )}
    </div>
  );
}

export default TomaFisicaPanel;
