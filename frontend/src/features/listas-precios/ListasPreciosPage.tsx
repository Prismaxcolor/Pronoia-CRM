import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, ChevronRight, Tag } from 'lucide-react';
import {
  obtenerListas,
  eliminarLista,
} from '../../services/lista-precios-service';
import { useAuth } from '../../hooks/use-auth';
import { useToast } from '../../hooks/use-toast';
import { useConfirm } from '../../hooks/use-confirm';
import ListaFormModal from './ListaFormModal';
import type { ListaPrecios } from '@shared/types/index.js';

function ListasPreciosPage() {
  const [listas, setListas] = useState<ListaPrecios[]>([]);
  const [cargando, setCargando] = useState(true);
  const [formAbierto, setFormAbierto] = useState<
    { abierto: true; lista: ListaPrecios | null } | { abierto: false }
  >({ abierto: false });
  const navigate = useNavigate();
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const confirmar = useConfirm();

  const puedeCrear = tienePermiso('productos', 'crear');
  const puedeEditar = tienePermiso('productos', 'editar');
  const puedeBorrar = tienePermiso('productos', 'eliminar');

  const cargar = () => {
    setCargando(true);
    obtenerListas().then(setListas).finally(() => setCargando(false));
  };

  useEffect(() => { cargar(); }, []);

  const handleBorrar = async (l: ListaPrecios, e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await confirmar({
      titulo: `Eliminar "${l.nombre}"`,
      mensaje: 'Se borrarán también todos sus precios. Si la lista está usada en alguna factura, no se podrá borrar.',
      confirmarLabel: 'Eliminar',
      variante: 'danger',
    });
    if (!ok) return;
    const result = await eliminarLista(l.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${l.nombre}" eliminada.`);
    cargar();
  };

  const handleEditar = (l: ListaPrecios, e: React.MouseEvent) => {
    e.stopPropagation();
    setFormAbierto({ abierto: true, lista: l });
  };

  if (cargando) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Listas de precios</h1>
          <p className="text-sm text-text-secondary mt-1">
            Cuánto se paga por cada material. Se usan al facturar compras.
          </p>
        </div>
        {puedeCrear && (
          <button
            type="button"
            onClick={() => setFormAbierto({ abierto: true, lista: null })}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            <Plus size={18} />
            Nueva lista
          </button>
        )}
      </div>

      {listas.length === 0 ? (
        <p className="text-center text-text-muted py-12">No hay listas de precios todavía.</p>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          {listas.map(l => (
            <div
              key={l.id}
              onClick={() => navigate(`/listas-precios/${l.id}`)}
              className="group flex items-center gap-4 px-5 py-4 border-b border-border last:border-b-0 hover:bg-surface-alt cursor-pointer transition-colors"
            >
              <div className="w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 shrink-0">
                <Tag size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-text-primary text-sm truncate">{l.nombre}</h3>
                  {!l.activo && (
                    <span className="px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded-full shrink-0">Inactiva</span>
                  )}
                </div>
                <p className="text-xs text-text-muted mt-0.5">
                  {l.vigenteDesde ? `Vigente desde ${l.vigenteDesde}` : 'Sin fecha de vigencia'}
                </p>
              </div>

              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {puedeEditar && (
                  <button
                    type="button"
                    onClick={e => handleEditar(l, e)}
                    className="p-1.5 rounded-md bg-surface-alt hover:bg-brand-50 text-text-muted hover:text-brand-600 transition-colors"
                    title="Editar lista"
                  >
                    <Pencil size={14} />
                  </button>
                )}
                {puedeBorrar && (
                  <button
                    type="button"
                    onClick={e => handleBorrar(l, e)}
                    className="p-1.5 rounded-md bg-surface-alt hover:bg-red-50 text-text-muted hover:text-red-600 transition-colors"
                    title="Eliminar lista"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <ChevronRight size={18} className="text-text-muted shrink-0" />
            </div>
          ))}
        </div>
      )}

      {formAbierto.abierto && (
        <ListaFormModal
          lista={formAbierto.lista}
          onClose={() => setFormAbierto({ abierto: false })}
          onGuardado={() => { setFormAbierto({ abierto: false }); cargar(); }}
        />
      )}
    </div>
  );
}

export default ListasPreciosPage;
