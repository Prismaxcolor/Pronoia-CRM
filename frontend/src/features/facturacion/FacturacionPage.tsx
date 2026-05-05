import { useEffect, useState } from 'react';
import { Search, Package, ShoppingCart, X, Plus, Minus, Check } from 'lucide-react';
import { obtenerProductos } from '../../services/producto-service';
import { crearFactura } from '../../services/factura-service';
import { useAuth } from '../../hooks/use-auth';
import type { Producto, TipoProducto } from '@shared/types/index.js';

interface ItemFactura {
  producto: Producto;
  cantidad: number;
}

const TIPO_FILTER: { tipo: TipoProducto | 'todos'; label: string; color: string }[] = [
  { tipo: 'todos', label: 'Todos', color: 'bg-gray-500' },
  { tipo: 'amarillo', label: 'Basico', color: 'bg-yellow-400' },
  { tipo: 'azul', label: 'Variantes', color: 'bg-blue-500' },
  { tipo: 'verde', label: 'Compuesto', color: 'bg-green-500' },
];

function getCosto(p: Producto): number {
  if (p.tipo === 'amarillo') return p.costoUnitario;
  if (p.tipo === 'azul') return p.variantes[0]?.precioUnitario ?? 0;
  return p.costoCalculado;
}

function FacturacionPage() {
  const { usuario } = useAuth();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<TipoProducto | 'todos'>('todos');
  const [carrito, setCarrito] = useState<ItemFactura[]>([]);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [exito, setExito] = useState(false);

  useEffect(() => {
    obtenerProductos().then(setProductos).finally(() => setCargando(false));
  }, []);

  const productosFiltrados = productos
    .filter(p => p.activo)
    .filter(p => filtroTipo === 'todos' || p.tipo === filtroTipo)
    .filter(p =>
      p.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      p.categoria.toLowerCase().includes(busqueda.toLowerCase()) ||
      p.descripcion.toLowerCase().includes(busqueda.toLowerCase())
    );

  const agregarAlCarrito = (producto: Producto) => {
    setCarrito(prev => {
      const existente = prev.find(i => i.producto.id === producto.id);
      if (existente) {
        return prev.map(i => i.producto.id === producto.id ? { ...i, cantidad: i.cantidad + 1 } : i);
      }
      return [...prev, { producto, cantidad: 1 }];
    });
  };

  const actualizarCantidad = (productoId: string, delta: number) => {
    setCarrito(prev =>
      prev
        .map(i => i.producto.id === productoId ? { ...i, cantidad: i.cantidad + delta } : i)
        .filter(i => i.cantidad > 0)
    );
  };

  const removerDelCarrito = (productoId: string) => {
    setCarrito(prev => prev.filter(i => i.producto.id !== productoId));
  };

  const total = carrito.reduce((sum, item) => sum + getCosto(item.producto) * item.cantidad, 0);

  const handleGenerarFactura = async () => {
    if (!usuario || carrito.length === 0) return;
    setGuardando(true);

    const result = await crearFactura({
      creadoPor: usuario.id,
      moneda: 'USD',
      nota,
      items: carrito.map(item => ({
        productoId: item.producto.id,
        nombreProducto: item.producto.nombre,
        cantidad: item.cantidad,
        precioUnitario: getCosto(item.producto),
      })),
    });

    setGuardando(false);

    if (result) {
      setExito(true);
      setCarrito([]);
      setNota('');
      setTimeout(() => setExito(false), 3000);
    }
  };

  if (cargando) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <h1 className="text-2xl font-bold text-text-primary mb-4">Facturacion</h1>

      {exito && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-xl flex items-center gap-2 text-green-700 text-sm">
          <Check size={18} />
          Factura generada y guardada exitosamente
        </div>
      )}

      <div className="flex gap-6 flex-1 min-h-0">
        {/* Catálogo */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="relative mb-4">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Buscar por nombre, categoria o descripcion..."
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-surface border border-border rounded-xl text-sm
                         focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
            />
          </div>

          <div className="flex gap-2 mb-4">
            {TIPO_FILTER.map(f => (
              <button
                key={f.tipo}
                type="button"
                onClick={() => setFiltroTipo(f.tipo)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium transition-all ${
                  filtroTipo === f.tipo
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'bg-surface border border-border text-text-secondary hover:border-brand-300'
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full ${f.color}`} />
                {f.label}
              </button>
            ))}
            <span className="ml-auto text-xs text-text-muted self-center">{productosFiltrados.length} productos</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {productosFiltrados.map(p => {
                const enCarrito = carrito.find(i => i.producto.id === p.id);
                return (
                  <div
                    key={p.id}
                    onClick={() => agregarAlCarrito(p)}
                    className={`bg-surface rounded-xl border cursor-pointer transition-all hover:shadow-md relative ${
                      enCarrito ? 'border-brand-400 ring-1 ring-brand-200' : 'border-border hover:border-brand-300'
                    }`}
                  >
                    <div className="aspect-square bg-surface-alt rounded-t-xl overflow-hidden flex items-center justify-center">
                      {p.imagenUrl ? (
                        <img src={p.imagenUrl} alt={p.nombre} className="w-full h-full object-cover" />
                      ) : (
                        <Package size={40} className="text-text-muted/30" />
                      )}
                    </div>
                    <div className={`absolute top-2 right-2 w-3 h-3 rounded-full shadow-sm ${
                      p.tipo === 'amarillo' ? 'bg-yellow-400' :
                      p.tipo === 'azul' ? 'bg-blue-500' : 'bg-green-500'
                    }`} />
                    <div className="p-3">
                      <h3 className="text-xs font-semibold text-text-primary truncate">{p.nombre}</h3>
                      <p className="text-xs text-text-muted truncate">{p.categoria}</p>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-sm font-bold text-brand-600">${getCosto(p).toLocaleString()}</span>
                        {enCarrito && (
                          <span className="bg-brand-600 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
                            {enCarrito.cantidad}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {productosFiltrados.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16">
                <Package size={48} className="text-text-muted/30 mb-3" />
                <p className="text-text-muted text-sm">No se encontraron productos</p>
              </div>
            )}
          </div>
        </div>

        {/* Carrito */}
        <div className="w-80 bg-surface rounded-xl border border-border flex flex-col shadow-sm">
          <div className="p-4 border-b border-border">
            <div className="flex items-center gap-2">
              <ShoppingCart size={20} className="text-brand-600" />
              <h2 className="font-bold text-text-primary">Factura</h2>
              <span className="ml-auto bg-brand-100 text-brand-700 text-xs px-2 py-0.5 rounded-full font-medium">
                {carrito.length} item{carrito.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {carrito.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <ShoppingCart size={32} className="text-text-muted/30 mb-2" />
                <p className="text-sm text-text-muted">Selecciona productos del catalogo</p>
              </div>
            ) : (
              carrito.map(item => (
                <div key={item.producto.id} className="flex items-center gap-3 p-2 rounded-lg bg-surface-alt">
                  <div className="w-10 h-10 rounded-lg bg-surface border border-border overflow-hidden flex-shrink-0 flex items-center justify-center">
                    {item.producto.imagenUrl ? (
                      <img src={item.producto.imagenUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Package size={16} className="text-text-muted/50" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-text-primary truncate">{item.producto.nombre}</p>
                    <p className="text-xs text-text-muted">${getCosto(item.producto)} c/u</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => actualizarCantidad(item.producto.id, -1)} className="w-6 h-6 rounded-md bg-surface border border-border flex items-center justify-center hover:bg-red-50 transition-colors">
                      <Minus size={12} />
                    </button>
                    <span className="text-xs font-bold w-6 text-center">{item.cantidad}</span>
                    <button type="button" onClick={() => actualizarCantidad(item.producto.id, 1)} className="w-6 h-6 rounded-md bg-surface border border-border flex items-center justify-center hover:bg-green-50 transition-colors">
                      <Plus size={12} />
                    </button>
                  </div>
                  <button type="button" onClick={() => removerDelCarrito(item.producto.id)} className="text-text-muted hover:text-red-500 transition-colors">
                    <X size={14} />
                  </button>
                </div>
              ))
            )}
          </div>

          {carrito.length > 0 && (
            <div className="p-4 border-t border-border space-y-3">
              <textarea
                placeholder="Nota (opcional)"
                value={nota}
                onChange={e => setNota(e.target.value)}
                className="w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-xs resize-none focus:outline-none focus:ring-2 focus:ring-brand-400"
                rows={2}
              />
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Total</span>
                <span className="text-xl font-bold text-text-primary">${total.toLocaleString()}</span>
              </div>
              <button
                type="button"
                disabled={guardando}
                onClick={handleGenerarFactura}
                className="w-full py-3 bg-brand-600 text-white rounded-xl font-semibold text-sm hover:bg-brand-700 transition-colors disabled:opacity-50"
              >
                {guardando ? 'Generando...' : 'Generar factura'}
              </button>
              <button
                type="button"
                onClick={() => setCarrito([])}
                className="w-full py-2 text-sm text-text-muted hover:text-red-500 transition-colors"
              >
                Limpiar todo
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default FacturacionPage;
