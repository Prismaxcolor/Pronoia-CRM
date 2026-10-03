import { useEffect, useState } from 'react';
import { Plus, Pencil, EyeOff, Eye, Warehouse, Star, AlertTriangle } from 'lucide-react';
import {
  obtenerAlmacenes,
  desactivarAlmacen,
  reactivarAlmacen,
  marcarPredeterminado,
} from '../../services/almacen-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import AlmacenFormModal from './AlmacenFormModal';
import type { Almacen } from '@shared/types/index.js';

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function AlmacenesPanel() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const puedeCrear = tienePermiso('almacenes', 'crear');
  const puedeEditar = tienePermiso('almacenes', 'editar');

  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [cargando, setCargando] = useState(true);
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Almacenes</h2>
          <p className="text-sm text-text-secondary mt-1">
            Cada almacén tiene su propio inventario: compras y ventas afectan al almacén
            predeterminado (<Star size={12} className="inline fill-amber-400 text-amber-500 -mt-0.5" />),
            y los traslados mueven material entre almacenes.
          </p>
          <p className="text-xs text-text-muted mt-1">
            Para ver cuánto material hay en cada almacén, usa el filtro "Almacén" en la
            pestaña Inventario.
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
              <div className="flex flex-wrap items-center gap-3 px-4 sm:px-5 py-3.5">
                <div className="w-11 h-11 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 shrink-0">
                  <Warehouse size={18} />
                </div>
                <div className="flex-1 min-w-[10rem]">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-text-primary text-sm truncate">{a.nombre}</h3>
                    {!a.activo && (
                      <span className="px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded-full shrink-0">Inactivo</span>
                    )}
                  </div>
                  {a.detalle && <p className="text-xs text-text-muted truncate">{a.detalle}</p>}
                  <p className="text-xs text-text-muted">
                    Última toma física: {a.ultimaTomaFisica ? fmtFecha(a.ultimaTomaFisica) : 'nunca'}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-auto">
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
              </div>
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
