import { useEffect, useState } from 'react';
import { Plus, Pencil, EyeOff, Eye, Warehouse, ChevronDown, ChevronRight, ChevronUp, Star, AlertTriangle, Boxes } from 'lucide-react';
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
    return (
      <div className="px-5 py-6 flex items-center justify-center bg-surface-alt/40">
        <div className="w-5 h-5 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }
  if (grupos.length === 0) {
    return (
      <div className="px-5 py-8 bg-surface-alt/40 text-center">
        <Boxes size={22} className="mx-auto text-text-muted/50 mb-2" />
        <p className="text-xs text-text-muted">Sin movimientos todavía en este almacén.</p>
      </div>
    );
  }
  return (
    <div className="px-4 py-3 bg-surface-alt/40 space-y-2">
      {grupos.map(g => {
        const clave = g.tipoMaterialId ?? '__sin__';
        return (
          <div key={clave} className="bg-surface rounded-lg border border-border/70 overflow-hidden">
            <button
              type="button"
              onClick={() => toggle(clave)}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-surface-alt/60 transition-colors"
            >
              {expandidos.has(clave) ? <ChevronDown size={14} className="text-text-muted shrink-0" /> : <ChevronRight size={14} className="text-text-muted shrink-0" />}
              <span className="text-xs font-semibold text-text-primary flex-1 text-left truncate">{g.nombreCategoria}</span>
              <span className="text-[11px] text-text-muted">{g.articulos.length} art.</span>
              <span className={`text-xs font-bold tabular-nums px-2 py-0.5 rounded-full ${g.totalKg < 0 ? 'bg-red-50 text-red-600' : 'bg-brand-50 text-brand-700'}`}>
                {fmt(g.totalKg)} kg
              </span>
            </button>

            {expandidos.has(clave) && (
              <div className="border-t border-border/70 divide-y divide-border/50">
                {g.articulos.map(a => (
                  <div key={a.productoId} className="flex items-center gap-3 px-3.5 py-2 text-xs">
                    <span className="text-text-secondary flex-1 truncate">{a.nombre}</span>
                    <span className="text-text-muted tabular-nums w-16 text-right" title="Entradas">+{fmt(a.entradas)}</span>
                    <span className="text-text-muted tabular-nums w-16 text-right" title="Salidas">−{fmt(a.salidas)}</span>
                    <span className={`font-semibold tabular-nums w-20 text-right ${a.stock < 0 ? 'text-red-600' : 'text-text-primary'}`}>
                      {fmt(a.stock)} kg
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AlmacenesPanel() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const puedeCrear = tienePermiso('almacenes', 'crear');
  const puedeEditar = tienePermiso('almacenes', 'editar');

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
