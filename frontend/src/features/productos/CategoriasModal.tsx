import { useEffect, useState } from 'react';
import { X, Plus, Pencil, Check, EyeOff, Eye } from 'lucide-react';
import {
  obtenerTiposMaterial,
  crearTipoMaterial,
  actualizarTipoMaterial,
  desactivarTipoMaterial,
  reactivarTipoMaterial,
} from '../../services/tipo-material-service';
import { useToast } from '../../hooks/use-toast';
import { useAuth } from '../../hooks/use-auth';
import type { TipoMaterial } from '@shared/types/index.js';

interface Props {
  onClose: () => void;
  /** Se llama si hubo algún cambio, para que la página recargue productos/nombres. */
  onCambios: () => void;
}

function CategoriasModal({ onClose, onCambios }: Props) {
  const toast = useToast();
  const { tienePermiso } = useAuth();

  const [categorias, setCategorias] = useState<TipoMaterial[]>([]);
  const [cargando, setCargando] = useState(true);
  const [huboCambios, setHuboCambios] = useState(false);

  const [nuevoNombre, setNuevoNombre] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState('');

  const puedeCrear = tienePermiso('productos', 'crear');
  const puedeEditar = tienePermiso('productos', 'editar');

  const cargar = () => {
    setCargando(true);
    obtenerTiposMaterial().then(setCategorias).finally(() => setCargando(false));
  };

  useEffect(() => { cargar(); }, []);

  const marcarCambio = () => { setHuboCambios(true); };

  const handleCerrar = () => {
    if (huboCambios) onCambios();
    onClose();
  };

  const handleCrear = async (e: React.FormEvent) => {
    e.preventDefault();
    const nombre = nuevoNombre.trim();
    if (!nombre) return;
    const result = await crearTipoMaterial({ nombre });
    if ('error' in result) { toast.errorMsg(result.error); return; }
    setNuevoNombre('');
    toast.exito(`Categoría "${result.tipo.nombre}" creada.`);
    marcarCambio();
    cargar();
  };

  const empezarEdicion = (c: TipoMaterial) => {
    setEditId(c.id);
    setEditNombre(c.nombre);
  };

  const guardarEdicion = async (c: TipoMaterial) => {
    const nombre = editNombre.trim();
    if (!nombre || nombre === c.nombre) { setEditId(null); return; }
    const result = await actualizarTipoMaterial(c.id, { nombre });
    if ('error' in result) { toast.errorMsg(result.error); return; }
    setEditId(null);
    toast.exito('Categoría actualizada.');
    marcarCambio();
    cargar();
  };

  const toggleActivo = async (c: TipoMaterial) => {
    const result = c.activo
      ? await desactivarTipoMaterial(c.id)
      : await reactivarTipoMaterial(c.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(c.activo ? `"${c.nombre}" desactivada.` : `"${c.nombre}" reactivada.`);
    marcarCambio();
    cargar();
  };

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-lg font-bold text-text-primary">Categorías de materiales</h2>
            <p className="text-xs text-text-muted mt-0.5">Agrupan el inventario (PCB, No Ferroso, Merma...)</p>
          </div>
          <button type="button" onClick={handleCerrar} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {puedeCrear && (
            <form onSubmit={handleCrear} className="flex gap-2">
              <input
                type="text"
                value={nuevoNombre}
                onChange={e => setNuevoNombre(e.target.value)}
                className={inputClass}
                placeholder="Nueva categoría..."
                maxLength={80}
              />
              <button
                type="submit"
                disabled={!nuevoNombre.trim()}
                className="flex items-center gap-1.5 px-3 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50 shrink-0"
              >
                <Plus size={16} />
                Agregar
              </button>
            </form>
          )}

          {cargando ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
            </div>
          ) : categorias.length === 0 ? (
            <p className="text-center text-text-muted py-8 text-sm">No hay categorías todavía.</p>
          ) : (
            <ul className="border border-border rounded-xl overflow-hidden">
              {categorias.map(c => (
                <li
                  key={c.id}
                  className={`flex items-center gap-2 px-4 py-2.5 border-b border-border last:border-b-0 ${
                    !c.activo ? 'opacity-60' : ''
                  }`}
                >
                  {editId === c.id ? (
                    <>
                      <input
                        autoFocus
                        value={editNombre}
                        onChange={e => setEditNombre(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') guardarEdicion(c); if (e.key === 'Escape') setEditId(null); }}
                        className="flex-1 px-2 py-1 bg-surface-alt border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                        maxLength={80}
                      />
                      <button
                        type="button"
                        onClick={() => guardarEdicion(c)}
                        className="p-1.5 rounded-md bg-brand-50 text-brand-600 hover:bg-brand-100 transition-colors"
                        title="Guardar"
                      >
                        <Check size={15} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm text-text-primary truncate">
                        {c.nombre}
                        {!c.activo && <span className="ml-2 text-xs text-red-500">(inactiva)</span>}
                      </span>
                      {puedeEditar && (
                        <>
                          <button
                            type="button"
                            onClick={() => empezarEdicion(c)}
                            className="p-1.5 rounded-md text-text-muted hover:bg-brand-50 hover:text-brand-600 transition-colors"
                            title="Renombrar"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleActivo(c)}
                            className={`p-1.5 rounded-md text-text-muted transition-colors ${
                              c.activo ? 'hover:bg-amber-50 hover:text-amber-600' : 'hover:bg-green-50 hover:text-green-600'
                            }`}
                            title={c.activo ? 'Desactivar' : 'Reactivar'}
                          >
                            {c.activo ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-text-muted">
            Desactivar una categoría la oculta del selector de productos, pero conserva los que ya la usan.
          </p>
        </div>
      </div>
    </div>
  );
}

export default CategoriasModal;
