import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { obtenerProductos } from '../../services/producto-service';
import { useAuth } from '../../hooks/use-auth';
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
  const [mostrarForm, setMostrarForm] = useState(false);
  const { tienePermiso } = useAuth();

  const cargar = () => {
    setCargando(true);
    obtenerProductos().then(setProductos).finally(() => setCargando(false));
  };

  useEffect(() => { cargar(); }, []);

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
        {tienePermiso('productos', 'crear') && (
          <button
            type="button"
            onClick={() => setMostrarForm(true)}
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
            <div key={p.id} className="bg-surface rounded-xl p-5 shadow-sm border border-border hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-semibold text-text-primary text-sm leading-tight">{p.nombre}</h3>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.color}`}>
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

      {/* Modal del formulario */}
      {mostrarForm && (
        <ProductoForm
          onClose={() => setMostrarForm(false)}
          onCreado={() => { setMostrarForm(false); cargar(); }}
        />
      )}
    </div>
  );
}

export default ProductosPage;
