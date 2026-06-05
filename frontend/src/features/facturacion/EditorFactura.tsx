import { useEffect, useState } from 'react';
import { Search, Package, ShoppingCart, X, Plus, Minus, ArrowLeft, Check, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { obtenerProductos } from '../../services/producto-service';
import {
  obtenerFacturaPorId, agregarItem, actualizarCantidadItem, eliminarItem,
  actualizarNotaFactura, confirmarFactura,
} from '../../services/factura-service';
import { useToast } from '../../hooks/use-toast';
import { useConfirm } from '../../hooks/use-confirm';
import type { Producto, TipoProducto, Factura, FacturaItem } from '@shared/types/index.js';

interface Props {
  facturaId: string;
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

function EditorFactura({ facturaId }: Props) {
  const navigate = useNavigate();
  const toast = useToast();
  const confirmar = useConfirm();
  const [factura, setFactura] = useState<Factura | null>(null);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [items, setItems] = useState<FacturaItem[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<TipoProducto | 'todos'>('todos');
  const [nota, setNota] = useState('');
  const [guardandoItem, setGuardandoItem] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  // Carga inicial
  useEffect(() => {
    let abortado = false;
    (async () => {
      const [f, ps] = await Promise.all([obtenerFacturaPorId(facturaId), obtenerProductos()]);

      if (abortado) return;

      if (!f || f.estado !== 'borrador') {
        navigate('/facturacion', { replace: true });
        return;
      }

      setFactura(f);
      setItems(f.items);
      setNota(f.nota);
      setProductos(ps);
      setCargando(false);
    })();
    return () => { abortado = true; };
  }, [facturaId, navigate]);

  const productosFiltrados = productos
    .filter(p => p.activo)
    .filter(p => filtroTipo === 'todos' || p.tipo === filtroTipo)
    .filter(p =>
      p.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      (p.tipoMaterialNombre ?? '').toLowerCase().includes(busqueda.toLowerCase()) ||
      p.descripcion.toLowerCase().includes(busqueda.toLowerCase())
    );

  const total = items.reduce((sum, item) => sum + Number(item.subtotal), 0);

  const handleAgregarProducto = async (producto: Producto) => {
    if (!factura) return;
    const precio = getCosto(producto);
    const existente = items.find(i => i.productoId === producto.id);

    setGuardandoItem(producto.id);
    if (existente) {
      const nuevaCantidad = existente.cantidad + 1;
      const ok = await actualizarCantidadItem(existente.id, nuevaCantidad, precio, factura.id);
      if (ok) {
        setItems(prev => prev.map(i =>
          i.id === existente.id ? { ...i, cantidad: nuevaCantidad, subtotal: nuevaCantidad * precio } : i
        ));
      }
    } else {
      const nuevo = await agregarItem({
        facturaId: factura.id,
        productoId: producto.id,
        nombreProducto: producto.nombre,
        cantidad: 1,
        precioUnitario: precio,
      });
      if (nuevo) setItems(prev => [...prev, nuevo]);
    }
    setGuardandoItem(null);
  };

  const handleDelta = async (item: FacturaItem, delta: number) => {
    if (!factura) return;
    const nuevaCantidad = item.cantidad + delta;
    if (nuevaCantidad <= 0) {
      await handleRemover(item);
      return;
    }
    setGuardandoItem(item.id);
    const ok = await actualizarCantidadItem(item.id, nuevaCantidad, item.precioUnitario, factura.id);
    if (ok) {
      setItems(prev => prev.map(i =>
        i.id === item.id ? { ...i, cantidad: nuevaCantidad, subtotal: nuevaCantidad * i.precioUnitario } : i
      ));
    }
    setGuardandoItem(null);
  };

  const handleRemover = async (item: FacturaItem) => {
    if (!factura) return;
    setGuardandoItem(item.id);
    const ok = await eliminarItem(item.id, factura.id);
    if (ok) setItems(prev => prev.filter(i => i.id !== item.id));
    setGuardandoItem(null);
  };

  const handleNotaBlur = async () => {
    if (!factura || nota === factura.nota) return;
    await actualizarNotaFactura(factura.id, nota);
    setFactura(prev => prev ? { ...prev, nota } : prev);
  };

  const handleConfirmar = async () => {
    if (!factura) return;
    if (items.length === 0) {
      toast.advertencia('Agrega al menos un producto antes de confirmar la factura.');
      return;
    }
    const totalFmt = `${factura.moneda === 'USD' ? '$' : 'Bs '}${total.toLocaleString()}`;
    const ok = await confirmar({
      titulo: `Confirmar factura #${factura.numero}`,
      mensaje: `Total: ${totalFmt}\n\nUna vez confirmada no podrás editarla. Si necesitas cambiar algo, hazlo ahora.`,
      confirmarLabel: 'Confirmar factura',
      variante: 'default',
    });
    if (!ok) return;

    setConfirmando(true);
    const okConfirmar = await confirmarFactura(factura.id);
    setConfirmando(false);

    if (okConfirmar) {
      toast.exito(`Factura #${factura.numero} confirmada.`);
      navigate('/historial');
    } else {
      toast.errorMsg('No se pudo confirmar la factura. Intenta de nuevo.');
    }
  };

  const handleVolver = () => navigate('/facturacion');

  if (cargando || !factura) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header con info de la factura */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button
          type="button"
          onClick={handleVolver}
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          <ArrowLeft size={16} />
          Volver
        </button>
        <div className="h-5 w-px bg-border" />
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-text-primary">Factura #{factura.numero}</h1>
          <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-medium">
            borrador
          </span>
        </div>
        <span className="text-xs text-text-muted ml-auto">Los cambios se guardan automáticamente</span>
      </div>

      <div className="flex gap-6 flex-1 min-h-0">
        {/* Catálogo */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="relative mb-4">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Buscar por nombre, categoría o descripción..."
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
            />
          </div>

          <div className="flex gap-2 mb-4 flex-wrap">
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
            <span className="ml-auto text-xs text-text-muted self-center">
              {productosFiltrados.length} productos
            </span>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {productosFiltrados.map(p => {
                const enCarrito = items.find(i => i.productoId === p.id);
                const guardando = guardandoItem === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleAgregarProducto(p)}
                    disabled={guardando}
                    className={`bg-surface rounded-xl border cursor-pointer transition-all hover:shadow-md relative text-left disabled:opacity-60 ${
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
                      <p className="text-xs text-text-muted truncate">{p.tipoMaterialNombre ?? 'Sin categoría'}</p>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-sm font-bold text-brand-600">${getCosto(p).toLocaleString()}</span>
                        {enCarrito && (
                          <span className="bg-brand-600 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
                            {enCarrito.cantidad}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
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

        {/* Panel lateral: items de la factura */}
        <div className="w-80 bg-surface rounded-xl border border-border flex flex-col shadow-sm">
          <div className="p-4 border-b border-border">
            <div className="flex items-center gap-2">
              <ShoppingCart size={20} className="text-brand-600" />
              <h2 className="font-bold text-text-primary">Items de la factura</h2>
              <span className="ml-auto bg-brand-100 text-brand-700 text-xs px-2 py-0.5 rounded-full font-medium">
                {items.length} {items.length === 1 ? 'item' : 'items'}
              </span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <ShoppingCart size={32} className="text-text-muted/30 mb-2" />
                <p className="text-sm text-text-muted">Click en un producto del catálogo para agregarlo</p>
              </div>
            ) : (
              items.map(item => {
                const productoRef = productos.find(p => p.id === item.productoId);
                const guardando = guardandoItem === item.id;
                return (
                  <div key={item.id} className={`flex items-center gap-3 p-2 rounded-lg bg-surface-alt transition-opacity ${guardando ? 'opacity-60' : ''}`}>
                    <div className="w-10 h-10 rounded-lg bg-surface border border-border overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {productoRef?.imagenUrl ? (
                        <img src={productoRef.imagenUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Package size={16} className="text-text-muted/50" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-text-primary truncate">{item.nombreProducto}</p>
                      <p className="text-xs text-text-muted">${item.precioUnitario.toLocaleString()} c/u</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleDelta(item, -1)}
                        disabled={guardando}
                        className="w-6 h-6 rounded-md bg-surface border border-border flex items-center justify-center hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="text-xs font-bold w-6 text-center">
                        {guardando ? <Loader2 size={10} className="animate-spin mx-auto" /> : item.cantidad}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDelta(item, 1)}
                        disabled={guardando}
                        className="w-6 h-6 rounded-md bg-surface border border-border flex items-center justify-center hover:bg-green-50 transition-colors disabled:opacity-50"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemover(item)}
                      disabled={guardando}
                      className="text-text-muted hover:text-red-500 transition-colors disabled:opacity-50"
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="p-4 border-t border-border space-y-3">
            <textarea
              placeholder="Nota (opcional)"
              value={nota}
              onChange={e => setNota(e.target.value)}
              onBlur={handleNotaBlur}
              className="w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-xs resize-none focus:outline-none focus:ring-2 focus:ring-brand-400"
              rows={2}
            />
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Total</span>
              <span className="text-xl font-bold text-text-primary">
                {factura.moneda === 'USD' ? '$' : 'Bs '}{total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <button
              type="button"
              disabled={confirmando || items.length === 0}
              onClick={handleConfirmar}
              className="w-full py-3 bg-brand-600 text-white rounded-xl font-semibold text-sm hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
            >
              {confirmando ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Confirmando...
                </>
              ) : (
                <>
                  <Check size={14} />
                  Confirmar factura
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default EditorFactura;
