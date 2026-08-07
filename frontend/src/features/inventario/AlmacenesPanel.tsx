import { useEffect, useState } from 'react';
import { Plus, Pencil, EyeOff, Eye, Warehouse, ChevronDown, ChevronUp, Star, AlertTriangle } from 'lucide-react';
import {
  obtenerAlmacenes,
  obtenerInventarioAlmacen,
  desactivarAlmacen,
  reactivarAlmacen,
  marcarPredeterminado,
} from '../../services/almacen-service';
import type { GrupoInventario } from '../../services/inventario-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import AlmacenFormModal from './AlmacenFormModal';
import Accordion from '../../components/Accordion';
import type { Almacen } from '@shared/types/index.js';

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Inventario propio de un almacén (colapsable), agrupado por categoría →
 *  producto igual que el inventario general — a partir de compras, ventas y
 *  traslados que quedaron ligados a este almacén. Se pide bajo demanda, no en
 *  la carga inicial de la lista. */
function StockAlmacen({ almacenId }: { almacenId: string }) {
  const [grupos, setGrupos] = useState<GrupoInventario[] | null>(null);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  useEffect(() => {
    obtenerInventarioAlmacen(almacenId).then(setGrupos);
  }, [almacenId]);

  const toggle = (clave: string) => {
    setExpandidos(prev => {
      const next = new Set(prev);
      if (next.has(clave)) next.delete(clave);
      else next.add(clave);
      return next;
    });
  };

  if (!grupos) {
    return <p className="text-xs text-text-muted px-5 py-3">Cargando inventario...</p>;
  }
  if (grupos.length === 0) {
    return <p className="text-xs text-text-muted px-5 py-3">Sin movimientos todavía en este almacén.</p>;
  }
  return (
    <div className="px-5 py-3 bg-surface-alt/60 space-y-2">
      {grupos.map(g => {
        const clave = g.tipoMaterialId ?? '__sin__';
        return (
          <Accordion
            key={clave}
            open={expandidos.has(clave)}
            onToggle={() => toggle(clave)}
            header={
              <>
                <span className="font-semibold text-text-primary text-xs flex-1 text-left">{g.nombreCategoria}</span>
                <span className="text-[11px] text-text-muted mr-2">{g.articulos.length} art.</span>
                <span className={`text-sm font-bold ${g.totalKg < 0 ? 'text-red-600' : 'text-text-primary'}`}>
                  {fmt(g.totalKg)} kg
                </span>
              </>
            }
          >
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] text-text-muted bg-surface-alt">
                  <th className="px-4 py-1.5 font-medium">Artículo</th>
                  <th className="px-3 py-1.5 font-medium text-right">Entradas</th>
                  <th className="px-3 py-1.5 font-medium text-right">Salidas</th>
                  <th className="px-4 py-1.5 font-medium text-right">Stock (kg)</th>
                </tr>
              </thead>
              <tbody>
                {g.articulos.map(a => (
                  <tr key={a.productoId} className="border-t border-border">
                    <td className="px-4 py-1.5 text-text-secondary">{a.nombre}</td>
                    <td className="px-3 py-1.5 text-right text-text-secondary">{fmt(a.entradas)}</td>
                    <td className="px-3 py-1.5 text-right text-text-secondary">{fmt(a.salidas)}</td>
                    <td className={`px-4 py-1.5 text-right font-medium ${a.stock < 0 ? 'text-red-600' : 'text-text-primary'}`}>
                      {fmt(a.stock)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </Accordion>
        );
      })}
    </div>
  );
}

function AlmacenesPanel() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const puedeCrear = tienePermiso('productos', 'crear');
  const puedeEditar = tienePermiso('productos', 'editar');

  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [cargando, setCargando] = useState(true);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [formAbierto, setFormAbierto] = useState<{ abierto: true; almacen: Almacen | null } | { abierto: false }>({ abierto: false });

  const recargar = () => obtenerAlmacenes().then(setAlmacenes).finally(() => setCargando(false));
  const cargar = () => { setCargando(true); recargar(); };

  useEffect(() => {
    recargar();
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

  const handlePredeterminado = async (a: Almacen) => {
    if (a.esPredeterminado) return;
    const result = await marcarPredeterminado(a.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`Ahora las compras y ventas afectan a "${a.nombre}".`);
    cargar();
  };

  const hayPredeterminado = almacenes.some(a => a.esPredeterminado && a.activo);

  if (cargando) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Almacenes</h2>
          <p className="text-sm text-text-secondary mt-1">
            Cada almacén tiene su propio inventario: compras y ventas afectan al almacén
            predeterminado (<Star size={12} className="inline fill-amber-400 text-amber-500 -mt-0.5" />),
            y los traslados mueven material entre almacenes.
          </p>
          <p className="text-xs text-text-muted mt-1">
            El inventario general incluye además los pesajes anteriores a los almacenes y las
            transformaciones, que no pertenecen a ningún almacén específico.
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

      {!hayPredeterminado && almacenes.length > 0 && (
        <div className="flex items-start gap-2 mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>Ningún almacén está marcado como predeterminado — las compras y ventas nuevas no afectarán a ningún almacén.</span>
        </div>
      )}

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
                {a.activo && (
                  <button
                    type="button"
                    onClick={() => handlePredeterminado(a)}
                    disabled={!puedeEditar || a.esPredeterminado}
                    title={a.esPredeterminado ? 'Almacén predeterminado' : puedeEditar ? 'Marcar como predeterminado' : 'Almacén predeterminado'}
                    className={`shrink-0 p-1 rounded-md transition-colors ${
                      a.esPredeterminado
                        ? 'fill-amber-400 text-amber-500'
                        : `text-text-muted ${puedeEditar ? 'hover:text-amber-500 cursor-pointer' : 'cursor-default'}`
                    }`}
                  >
                    <Star size={16} className={a.esPredeterminado ? 'fill-amber-400' : ''} />
                  </button>
                )}
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
              {expandido === a.id && <StockAlmacen almacenId={a.id} />}
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
