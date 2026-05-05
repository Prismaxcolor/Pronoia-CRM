import { useState, useRef } from 'react';
import { X, Plus, Trash2, ImagePlus } from 'lucide-react';
import { crearProducto } from '../../services/producto-service';
import { subirImagenProducto } from '../../services/storage-service';
import { useAuth } from '../../hooks/use-auth';
import type { TipoProducto, VarianteProducto, SubProductoRef } from '@shared/types/index.js';

interface Props {
  onClose: () => void;
  onCreado: () => void;
}

const TIPO_TABS: { tipo: TipoProducto; label: string; color: string; desc: string }[] = [
  { tipo: 'amarillo', label: 'Basico', color: 'bg-yellow-400', desc: 'Producto simple con peso y costo' },
  { tipo: 'azul', label: 'Variantes', color: 'bg-blue-500', desc: 'Producto con multiples presentaciones' },
  { tipo: 'verde', label: 'Compuesto', color: 'bg-green-500', desc: 'Producto formado por subproductos' },
];

function ProductoForm({ onClose, onCreado }: Props) {
  const { usuario } = useAuth();
  const [tipo, setTipo] = useState<TipoProducto>('amarillo');
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [categoria, setCategoria] = useState('');
  const [moneda, setMoneda] = useState('USD');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Imagen
  const [imagenFile, setImagenFile] = useState<File | null>(null);
  const [imagenPreview, setImagenPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Amarillo
  const [peso, setPeso] = useState(0);
  const [costoUnitario, setCostoUnitario] = useState(0);

  // Azul
  const [variantes, setVariantes] = useState<VarianteProducto[]>([
    { id: crypto.randomUUID(), nombre: '', cantidad: 0, precioUnitario: 0 },
  ]);

  // Verde
  const [subProductos, setSubProductos] = useState<SubProductoRef[]>([
    { productoId: '', cantidad: 1 },
  ]);
  const [costoCalculado, setCostoCalculado] = useState(0);

  const handleImagenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImagenFile(file);
    setImagenPreview(URL.createObjectURL(file));
  };

  const addVariante = () => setVariantes([...variantes, { id: crypto.randomUUID(), nombre: '', cantidad: 0, precioUnitario: 0 }]);
  const removeVariante = (idx: number) => setVariantes(variantes.filter((_, i) => i !== idx));
  const updateVariante = (idx: number, field: keyof VarianteProducto, value: string | number) => {
    setVariantes(variantes.map((v, i) => i === idx ? { ...v, [field]: value } : v));
  };

  const addSubProducto = () => setSubProductos([...subProductos, { productoId: '', cantidad: 1 }]);
  const removeSubProducto = (idx: number) => setSubProductos(subProductos.filter((_, i) => i !== idx));
  const updateSubProducto = (idx: number, field: keyof SubProductoRef, value: string | number) => {
    setSubProductos(subProductos.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);

    // Subir imagen primero si hay
    let imagenUrl: string | null = null;
    if (imagenFile) {
      imagenUrl = await subirImagenProducto(imagenFile);
      if (!imagenUrl) {
        setError('Error al subir la imagen. Intenta de nuevo.');
        setGuardando(false);
        return;
      }
    }

    const base = { nombre, descripcion, categoria, moneda, activo: true, imagenUrl, creadoPor: usuario?.id ?? '' };

    let producto;
    if (tipo === 'amarillo') {
      producto = { ...base, tipo: 'amarillo' as const, peso, costoUnitario };
    } else if (tipo === 'azul') {
      producto = { ...base, tipo: 'azul' as const, variantes };
    } else {
      producto = { ...base, tipo: 'verde' as const, subProductos, costoCalculado };
    }

    const result = await crearProducto(producto);
    setGuardando(false);

    if (result) {
      onCreado();
    } else {
      setError('Error al crear el producto. Verifica los datos.');
    }
  };

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-bold text-text-primary">Nuevo producto</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Selector de tipo */}
        <div className="flex gap-2 p-5 pb-0">
          {TIPO_TABS.map(tab => (
            <button
              key={tab.tipo}
              type="button"
              onClick={() => setTipo(tab.tipo)}
              className={`flex-1 p-3 rounded-xl border-2 transition-all text-center ${
                tipo === tab.tipo
                  ? 'border-brand-500 bg-brand-50 shadow-sm'
                  : 'border-border hover:border-brand-200'
              }`}
            >
              <div className={`w-3 h-3 rounded-full ${tab.color} mx-auto mb-1.5`} />
              <p className="text-xs font-semibold text-text-primary">{tab.label}</p>
              <p className="text-xs text-text-muted mt-0.5 hidden sm:block">{tab.desc}</p>
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Imagen */}
          <div>
            <label className={labelClass}>Imagen del producto</label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-border rounded-xl p-4 cursor-pointer hover:border-brand-400 transition-colors flex flex-col items-center justify-center min-h-[120px]"
            >
              {imagenPreview ? (
                <img src={imagenPreview} alt="Preview" className="max-h-28 object-contain rounded-lg" />
              ) : (
                <>
                  <ImagePlus size={32} className="text-text-muted mb-2" />
                  <p className="text-xs text-text-muted">Click para seleccionar imagen</p>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImagenChange}
              className="hidden"
            />
            {imagenFile && (
              <p className="text-xs text-text-secondary mt-1">{imagenFile.name}</p>
            )}
          </div>

          {/* Campos comunes */}
          <div>
            <label className={labelClass}>Nombre</label>
            <input type="text" required value={nombre} onChange={e => setNombre(e.target.value)} className={inputClass} placeholder="Nombre del producto" />
          </div>
          <div>
            <label className={labelClass}>Descripcion</label>
            <textarea value={descripcion} onChange={e => setDescripcion(e.target.value)} className={`${inputClass} resize-none`} rows={2} placeholder="Descripcion breve" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Categoria</label>
              <input type="text" required value={categoria} onChange={e => setCategoria(e.target.value)} className={inputClass} placeholder="Ej: Papeleria" />
            </div>
            <div>
              <label className={labelClass}>Moneda</label>
              <select value={moneda} onChange={e => setMoneda(e.target.value)} className={inputClass}>
                <option value="USD">USD</option>
                <option value="VES">VES</option>
              </select>
            </div>
          </div>

          {/* Campos AMARILLO */}
          {tipo === 'amarillo' && (
            <div className="grid grid-cols-2 gap-3 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
              <div>
                <label className={labelClass}>Peso (kg)</label>
                <input type="number" step="0.01" min="0" value={peso} onChange={e => setPeso(Number(e.target.value))} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Costo unitario</label>
                <input type="number" step="0.01" min="0" required value={costoUnitario} onChange={e => setCostoUnitario(Number(e.target.value))} className={inputClass} />
              </div>
            </div>
          )}

          {/* Campos AZUL */}
          {tipo === 'azul' && (
            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-text-secondary">Variantes</label>
                <button type="button" onClick={addVariante} className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800">
                  <Plus size={14} /> Agregar
                </button>
              </div>
              {variantes.map((v, idx) => (
                <div key={v.id} className="flex gap-2 items-end">
                  <div className="flex-1">
                    <input type="text" placeholder="Nombre" value={v.nombre} onChange={e => updateVariante(idx, 'nombre', e.target.value)} className={inputClass} />
                  </div>
                  <div className="w-20">
                    <input type="number" min="0" placeholder="Cant" value={v.cantidad} onChange={e => updateVariante(idx, 'cantidad', Number(e.target.value))} className={inputClass} />
                  </div>
                  <div className="w-24">
                    <input type="number" step="0.01" min="0" placeholder="Precio" value={v.precioUnitario} onChange={e => updateVariante(idx, 'precioUnitario', Number(e.target.value))} className={inputClass} />
                  </div>
                  {variantes.length > 1 && (
                    <button type="button" onClick={() => removeVariante(idx)} className="text-red-400 hover:text-red-600 p-1">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Campos VERDE */}
          {tipo === 'verde' && (
            <div className="p-3 bg-green-50 rounded-lg border border-green-200 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-text-secondary">Subproductos</label>
                <button type="button" onClick={addSubProducto} className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800">
                  <Plus size={14} /> Agregar
                </button>
              </div>
              {subProductos.map((s, idx) => (
                <div key={idx} className="flex gap-2 items-end">
                  <div className="flex-1">
                    <input type="text" placeholder="ID del producto" value={s.productoId} onChange={e => updateSubProducto(idx, 'productoId', e.target.value)} className={inputClass} />
                  </div>
                  <div className="w-20">
                    <input type="number" min="1" placeholder="Cant" value={s.cantidad} onChange={e => updateSubProducto(idx, 'cantidad', Number(e.target.value))} className={inputClass} />
                  </div>
                  {subProductos.length > 1 && (
                    <button type="button" onClick={() => removeSubProducto(idx)} className="text-red-400 hover:text-red-600 p-1">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
              <div>
                <label className={labelClass}>Costo calculado</label>
                <input type="number" step="0.01" min="0" value={costoCalculado} onChange={e => setCostoCalculado(Number(e.target.value))} className={inputClass} />
              </div>
            </div>
          )}

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? 'Guardando...' : 'Crear producto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ProductoForm;
