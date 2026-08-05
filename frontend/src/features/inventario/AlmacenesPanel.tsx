import { useEffect, useState } from 'react';
import { Plus, Pencil, EyeOff, Eye, Warehouse, ChevronDown, ChevronUp } from 'lucide-react';
import {
  obtenerAlmacenes,
  obtenerStockAlmacen,
  desactivarAlmacen,
  reactivarAlmacen,
} from '../../services/almacen-service';
import { obtenerProductos } from '../../services/producto-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import AlmacenFormModal from './AlmacenFormModal';
import type { Almacen, Producto } from '@shared/types/index.js';

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Inventario propio de un almacén (colapsable), derivado de sus traslados
 *  completados — se pide bajo demanda, no en la carga inicial de la lista. */
function StockAlmacen({ almacenId, productos }: { almacenId: string; productos: Producto[] }) {
  const [stock, setStock] = useState<Map<string, number> | null>(null);

  useEffect(() => {
    obtenerStockAlmacen(almacenId).then(setStock);
  }, [almacenId]);

  if (!stock) {
    return <p className="text-xs text-text-muted px-5 py-3">Cargando inventario...</p>;
  }
  const filas = Array.from(stock.entries()).filter(([, kg]) => kg !== 0);
  if (filas.length === 0) {
    return <p className="text-xs text-text-muted px-5 py-3">Sin movimientos todavía en este almacén.</p>;
  }
  return (
    <div className="px-5 py-3 bg-surface-alt/60">
      <table className="w-full text-xs">
        <tbody>
          {filas.map(([productoId, kg]) => (
            <tr key={productoId}>
              <td className="py-1 text-text-secondary">{productos.find(p => p.id === productoId)?.nombre ?? productoId}</td>
              <td className={`py-1 text-right font-medium ${kg < 0 ? 'text-red-600' : 'text-text-primary'}`}>{fmt(kg)} kg</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AlmacenesPanel() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const puedeCrear = tienePermiso('productos', 'crear');
  const puedeEditar = tienePermiso('productos', 'editar');

  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [formAbierto, setFormAbierto] = useState<{ abierto: true; almacen: Almacen | null } | { abierto: false }>({ abierto: false });

  const recargar = () => obtenerAlmacenes().then(setAlmacenes).finally(() => setCargando(false));
  const cargar = () => { setCargando(true); recargar(); };

  useEffect(() => {
    recargar();
    obtenerProductos().then(setProductos);
  }, []);

  const handleDesactivar = async (a: Almacen) => {
    const result = await desactivarAlmacen(a.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${a.nombre}" desactivado.`);
    cargar();
  };

  const handleReactivar = async (a: Almacen) => {
    const result = await reactivarAlmacen(a.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${a.nombre}" reactivado.`);
    cargar();
  };

  if (cargando) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Almacenes</h2>
          <p className="text-sm text-text-secondary mt-1">
            Cada almacén tiene su propio inventario, derivado de los traslados que recibió y envió.
          </p>
        </div>
        {puedeCrear && (
          <button
            type="button"
            onClick={() => setFormAbierto({ abierto: true, almacen: null })}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors shrink-0"
          >
            <Plus size={18} />
            Nuevo almacén
          </button>
        )}
      </div>

      {almacenes.length === 0 ? (
        <p className="text-center text-text-muted py-12 text-sm">No hay almacenes registrados.</p>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          {almacenes.map(a => (
            <div key={a.id} className={`border-b border-border last:border-b-0 ${!a.activo ? 'opacity-60' : ''}`}>
              <div className="flex items-center gap-4 px-5 py-3.5">
                <div className="w-11 h-11 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 shrink-0">
                  <Warehouse size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-text-primary text-sm truncate">{a.nombre}</h3>
                    {!a.activo && (
                      <span className="px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded-full shrink-0">Inactivo</span>
                    )}
                  </div>
                  {a.detalle && <p className="text-xs text-text-muted truncate">{a.detalle}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => setExpandido(prev => (prev === a.id ? null : a.id))}
                  className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 shrink-0"
                >
                  Inventario
                  {expandido === a.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {puedeEditar && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setFormAbierto({ abierto: true, almacen: a })}
                      className="p-1.5 rounded-md hover:bg-surface-alt text-text-muted hover:text-brand-600 transition-colors"
                      title="Editar almacén"
                    >
                      <Pencil size={15} />
                    </button>
                    {a.activo ? (
                      <button
                        type="button"
                        onClick={() => handleDesactivar(a)}
                        className="p-1.5 rounded-md hover:bg-surface-alt text-text-muted hover:text-amber-600 transition-colors"
                        title="Desactivar"
                      >
                        <EyeOff size={15} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleReactivar(a)}
                        className="p-1.5 rounded-md hover:bg-surface-alt text-text-muted hover:text-green-600 transition-colors"
                        title="Reactivar"
                      >
                        <Eye size={15} />
                      </button>
                    )}
                  </div>
                )}
              </div>
              {expandido === a.id && <StockAlmacen almacenId={a.id} productos={productos} />}
            </div>
          ))}
        </div>
      )}

      {formAbierto.abierto && (
        <AlmacenFormModal
          almacen={formAbierto.almacen}
          onClose={() => setFormAbierto({ abierto: false })}
          onGuardado={() => { setFormAbierto({ abierto: false }); cargar(); }}
        />
      )}
    </div>
  );
}

export default AlmacenesPanel;
