import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Check } from 'lucide-react';
import {
  obtenerListaDetalle,
  upsertPrecioEnLista,
  eliminarPrecio,
} from '../../services/lista-precios-service';
import { obtenerProductos } from '../../services/producto-service';
import { useAuth } from '../../hooks/use-auth';
import { useToast } from '../../hooks/use-toast';
import { useConfirm } from '../../hooks/use-confirm';
import type { ListaPrecios, PrecioLista, Producto } from '@shared/types/index.js';

function ListaDetallePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const confirmar = useConfirm();

  const [lista, setLista] = useState<ListaPrecios | null>(null);
  const [precios, setPrecios] = useState<PrecioLista[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);

  // edición inline: precio editado por productoId
  const [editado, setEditado] = useState<Record<string, string>>({});
  // alta de nuevo material
  const [nuevoProductoId, setNuevoProductoId] = useState('');
  const [nuevoPrecio, setNuevoPrecio] = useState('');

  const puedeEditar = tienePermiso('productos', 'editar');

  const cargar = () => {
    setCargando(true);
    Promise.all([obtenerListaDetalle(id), obtenerProductos()])
      .then(([detalle, prods]) => {
        if (detalle) {
          setLista(detalle.lista);
          setPrecios(detalle.precios);
        }
        setProductos(prods);
      })
      .finally(() => setCargando(false));
  };

  useEffect(() => { cargar(); }, [id]);

  // productos que aún no tienen precio en esta lista
  const productosDisponibles = useMemo(() => {
    const yaConPrecio = new Set(precios.map(p => p.productoId));
    return productos.filter(p => p.activo && !yaConPrecio.has(p.id));
  }, [productos, precios]);

  const guardarPrecio = async (productoId: string, valorCrudo: string) => {
    const valor = Number(valorCrudo);
    if (!Number.isFinite(valor) || valor <= 0) {
      toast.errorMsg('El precio debe ser un número mayor a 0.');
      return;
    }
    const result = await upsertPrecioEnLista(id, productoId, valor);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    setPrecios(prev => prev.map(p => (p.productoId === productoId ? result.precio : p)));
    setEditado(prev => { const n = { ...prev }; delete n[productoId]; return n; });
    toast.exito('Precio actualizado.');
  };

  const handleAgregar = async (e: React.FormEvent) => {
    e.preventDefault();
    const valor = Number(nuevoPrecio);
    if (!nuevoProductoId) { toast.errorMsg('Elige un material.'); return; }
    if (!Number.isFinite(valor) || valor <= 0) { toast.errorMsg('El precio debe ser mayor a 0.'); return; }
    const result = await upsertPrecioEnLista(id, nuevoProductoId, valor);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    setPrecios(prev => [...prev, result.precio]);
    setNuevoProductoId('');
    setNuevoPrecio('');
    toast.exito('Material agregado a la lista.');
  };

  const handleEliminar = async (p: PrecioLista) => {
    const ok = await confirmar({
      titulo: `Quitar "${p.nombreProducto ?? 'material'}" de la lista`,
      mensaje: 'Se eliminará su precio en esta lista.',
      confirmarLabel: 'Quitar',
      variante: 'warning',
    });
    if (!ok) return;
    const result = await eliminarPrecio(id, p.productoId);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    setPrecios(prev => prev.filter(x => x.productoId !== p.productoId));
    toast.exito('Material quitado de la lista.');
  };

  if (cargando) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!lista) {
    return (
      <div className="text-center py-12">
        <p className="text-text-muted mb-4">No se encontró la lista.</p>
        <button
          type="button"
          onClick={() => navigate('/listas-precios')}
          className="text-brand-600 hover:underline text-sm"
        >
          Volver a listas de precios
        </button>
      </div>
    );
  }

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate('/listas-precios')}
        className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors mb-4"
      >
        <ArrowLeft size={16} />
        Listas de precios
      </button>

      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-2xl font-bold text-text-primary">{lista.nombre}</h1>
        {!lista.activo && (
          <span className="px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded-full">Inactiva</span>
        )}
      </div>
      <p className="text-sm text-text-secondary mb-6">
        {lista.vigenteDesde ? `Vigente desde ${lista.vigenteDesde}` : 'Sin fecha de vigencia'}
      </p>

      {/* Alta de material */}
      {puedeEditar && (
        <form
          onSubmit={handleAgregar}
          className="bg-surface rounded-xl border border-border p-4 mb-6 flex flex-col sm:flex-row gap-3 sm:items-end"
        >
          <div className="flex-1">
            <label className="block text-xs font-medium text-text-secondary mb-1">Material</label>
            <select
              value={nuevoProductoId}
              onChange={e => setNuevoProductoId(e.target.value)}
              className={inputClass}
            >
              <option value="">Elige un material...</option>
              {productosDisponibles.map(p => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          </div>
          <div className="w-full sm:w-40">
            <label className="block text-xs font-medium text-text-secondary mb-1">Precio por kg</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={nuevoPrecio}
              onChange={e => setNuevoPrecio(e.target.value)}
              className={inputClass}
              placeholder="0.00"
            />
          </div>
          <button
            type="submit"
            className="flex items-center justify-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors shrink-0"
          >
            <Plus size={18} />
            Agregar
          </button>
        </form>
      )}

      {/* Tabla de precios */}
      {precios.length === 0 ? (
        <p className="text-center text-text-muted py-12">
          Esta lista no tiene materiales todavía.
        </p>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted">
                <th className="px-5 py-3 font-medium">Material</th>
                <th className="px-5 py-3 font-medium w-48">Precio por kg</th>
                {puedeEditar && <th className="px-5 py-3 w-12" />}
              </tr>
            </thead>
            <tbody>
              {precios.map(p => {
                const enEdicion = editado[p.productoId] !== undefined;
                const valor = enEdicion ? editado[p.productoId] : String(p.precio);
                return (
                  <tr key={p.id} className="border-b border-border last:border-b-0">
                    <td className="px-5 py-3 text-text-primary">
                      {p.nombreProducto ?? p.productoId}
                    </td>
                    <td className="px-5 py-3">
                      {puedeEditar ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={valor}
                            onChange={e =>
                              setEditado(prev => ({ ...prev, [p.productoId]: e.target.value }))
                            }
                            className="w-28 px-2 py-1.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                          />
                          {enEdicion && (
                            <button
                              type="button"
                              onClick={() => guardarPrecio(p.productoId, editado[p.productoId])}
                              className="p-1.5 rounded-md bg-brand-50 text-brand-600 hover:bg-brand-100 transition-colors"
                              title="Guardar precio"
                            >
                              <Check size={15} />
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-text-primary">{p.precio}</span>
                      )}
                    </td>
                    {puedeEditar && (
                      <td className="px-5 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleEliminar(p)}
                          className="p-1.5 rounded-md text-text-muted hover:bg-red-50 hover:text-red-600 transition-colors"
                          title="Quitar de la lista"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}

export default ListaDetallePage;
