import { useEffect, useState } from 'react';
import { Plus, Pencil, EyeOff, Eye, Trash2 } from 'lucide-react';
import {
  obtenerProductos,
  desactivarProducto,
  reactivarProducto,
  borrarProducto,
} from '../../services/producto-service';
import { useAuth } from '../../hooks/use-auth';
import { useToast } from '../../hooks/use-toast';
import { useConfirm } from '../../hooks/use-confirm';
import ProductoForm from './ProductoForm';
import type { Producto, TipoProducto } from '@shared/types/index.js';

const TIPO_CONFIG: Record<TipoProducto, { label: string; color: string; bg: string }> = {
  amarillo: { label: 'Basico', color: 'text-yellow-700', bg: 'bg-yellow-100' },
  azul: { label: 'Variantes', color: 'text-blue-700', bg: 'bg-blue-100' },
  verde: { label: 'Compuesto', color: 'text-green-700', bg: 'bg-green-100' },
};

function getCosto(p: Producto): string {
  if (p.tipo === 'amarillo') return `$${p.costoUnitario.toLocaleString()}`;
  if (p.tipo === 'azul') return `${p.variantes.length} variante(s)`;
  return `$${p.costoCalculado.toLocaleString()} (calc)`;
}

function ProductosPage() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [formAbierto, setFormAbierto] = useState<{ abierto: true; producto: Producto | null } | { abierto: false }>({ abierto: false });
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const confirmar = useConfirm();

  const puedeCrear = tienePermiso('productos', 'crear');
  const puedeEditar = tienePermiso('productos', 'editar');
  const puedeBorrar = tienePermiso('productos', 'eliminar');

  const cargar = () => {
    setCargando(true);
    obtenerProductos().then(setProductos).finally(() => setCargando(false));
  };

  useEffect(() => { cargar(); }, []);

  const handleDesactivar = async (p: Producto) => {
    const ok = await confirmar({
      titulo: `Desactivar "${p.nombre}"`,
      mensaje: 'El producto dejará de aparecer en el catálogo de facturación. Las facturas existentes que lo contienen no se modifican. Podrás reactivarlo más adelante.',
      confirmarLabel: 'Desactivar',
      variante: 'warning',
    });
    if (!ok) return;
    const result = await desactivarProducto(p.id);
    if ('error' in result) {
      toast.errorMsg(result.error);
      return;
    }
    toast.exito(`"${p.nombre}" desactivado.`);
    cargar();
  };

  const handleReactivar = async (p: Producto) => {
    const result = await reactivarProducto(p.id);
    if ('error' in result) {
      toast.errorMsg(result.error);
      return;
    }
    toast.exito(`"${p.nombre}" reactivado.`);
    cargar();
  };

  const handleBorrar = async (p: Producto) => {
    const ok = await confirmar({
      titulo: `Borrar "${p.nombre}" definitivamente`,
      mensaje: 'Esta acción es irreversible. Solo se permite si el producto NO aparece en ninguna factura.\n\nSi tiene historial, mantenlo desactivado en su lugar.',
      confirmarLabel: 'Borrar definitivamente',
      variante: 'danger',
    });
    if (!ok) return;
    const result = await borrarProducto(p.id);
    if ('error' in result) {
      toast.errorMsg(result.error);
      return;
    }
    toast.exito(`"${p.nombre}" eliminado.`);
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
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Productos</h1>
        {puedeCrear && (
          <button
            type="button"
            onClick={() => setFormAbierto({ abierto: true, producto: null })}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg
                       text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            <Plus size={18} />
            Nuevo producto
          </button>
        )}
      </div>

      {/* Leyenda de tipos */}
      <div className="flex gap-4 mb-4">
        {(Object.entries(TIPO_CONFIG) as [TipoProducto, typeof TIPO_CONFIG[TipoProducto]][]).map(([tipo, cfg]) => (
          <span key={tipo} className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${cfg.bg} ${cfg.color}`}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tipo === 'amarillo' ? '#F59E0B' : tipo === 'azul' ? '#3B82F6' : '#10B981' }} />
            {cfg.label}
          </span>
        ))}
      </div>

      {/* Grid de productos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {productos.map(p => {
          const cfg = TIPO_CONFIG[p.tipo];
          return (
            <div
              key={p.id}
              className={`group relative bg-surface rounded-xl p-5 shadow-sm border border-border hover:shadow-md transition-shadow ${
                !p.activo ? 'opacity-60' : ''
              }`}
            >
              {/* Acciones (top-right, hover) */}
              {(puedeEditar || puedeBorrar) && (
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {puedeEditar && (
                    <button
                      type="button"
                      onClick={() => setFormAbierto({ abierto: true, producto: p })}
                      className="p-1.5 rounded-md bg-surface-alt hover:bg-brand-50 text-text-muted hover:text-brand-600 transition-colors"
                      title="Editar producto"
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  {puedeEditar && p.activo && (
                    <button
                      type="button"
                      onClick={() => handleDesactivar(p)}
                      className="p-1.5 rounded-md bg-surface-alt hover:bg-amber-50 text-text-muted hover:text-amber-600 transition-colors"
                      title="Desactivar"
                    >
                      <EyeOff size={13} />
                    </button>
                  )}
                  {puedeEditar && !p.activo && (
                    <button
                      type="button"
                      onClick={() => handleReactivar(p)}
                      className="p-1.5 rounded-md bg-surface-alt hover:bg-green-50 text-text-muted hover:text-green-600 transition-colors"
                      title="Reactivar"
                    >
                      <Eye size={13} />
                    </button>
                  )}
                  {puedeBorrar && (
                    <button
                      type="button"
                      onClick={() => handleBorrar(p)}
                      className="p-1.5 rounded-md bg-surface-alt hover:bg-red-50 text-text-muted hover:text-red-600 transition-colors"
                      title="Borrar definitivamente"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              )}

              <div className="flex items-start justify-between mb-3">
                <h3 className="font-semibold text-text-primary text-sm leading-tight pr-20">{p.nombre}</h3>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.color} shrink-0`}>
                  {cfg.label}
                </span>
              </div>
              <p className="text-text-secondary text-xs mb-3 line-clamp-2">{p.descripcion}</p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-muted">{p.categoria}</span>
                <span className="text-sm font-bold text-text-primary">{getCosto(p)}</span>
              </div>
              {!p.activo && (
                <span className="mt-2 inline-block px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded-full">Inactivo</span>
              )}
            </div>
          );
        })}
      </div>

      {productos.length === 0 && (
        <p className="text-center text-text-muted py-12">No hay productos registrados</p>
      )}

      {formAbierto.abierto && (
        <ProductoForm
          producto={formAbierto.producto}
          onClose={() => setFormAbierto({ abierto: false })}
          onGuardado={() => { setFormAbierto({ abierto: false }); cargar(); }}
        />
      )}
    </div>
  );
}

export default ProductosPage;
