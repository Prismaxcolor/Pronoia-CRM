import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, ArrowRight, ArrowLeft, Loader2, Recycle } from 'lucide-react';
import {
  obtenerTransformaciones,
  crearTransformacion,
  type TransformacionHistorial,
} from '../../services/transformacion-service';
import { obtenerProductos } from '../../services/producto-service';
import { obtenerInventario } from '../../services/inventario-service';
import { useAuth } from '../../hooks/use-auth';
import { useToast } from '../../hooks/use-toast';
import type { Producto } from '@shared/types/index.js';

interface SalidaForm { materialSalidaId: string; cantidad: string }

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function TransformacionesPage() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const puedeCrear = tienePermiso('productos', 'crear');

  const [productos, setProductos] = useState<Producto[]>([]);
  const [stockMap, setStockMap] = useState<Map<string, number>>(new Map());
  const [historial, setHistorial] = useState<TransformacionHistorial[]>([]);

  const [paso, setPaso] = useState<1 | 2>(1);
  const [entradaId, setEntradaId] = useState('');
  const [cantidadEntrada, setCantidadEntrada] = useState('');
  const [fecha, setFecha] = useState(hoyISO());
  const [notas, setNotas] = useState('');
  const [salidas, setSalidas] = useState<SalidaForm[]>([{ materialSalidaId: '', cantidad: '' }]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargarDatos = () => {
    obtenerInventario().then(grupos => {
      const m = new Map<string, number>();
      grupos.flatMap(g => g.articulos).forEach(a => m.set(a.productoId, a.stock));
      setStockMap(m);
    });
    obtenerTransformaciones().then(setHistorial);
  };

  useEffect(() => {
    obtenerProductos().then(lista => setProductos(lista.filter(p => p.activo)));
    cargarDatos();
  }, []);

  const stockEntrada = stockMap.get(entradaId) ?? 0;
  const entradaNum = Number(cantidadEntrada) || 0;
  const sumaSalidas = salidas.reduce((s, x) => s + (Number(x.cantidad) || 0), 0);
  const merma = entradaNum - sumaSalidas;

  const nombrePorProducto = useMemo(() => {
    const m = new Map<string, string>();
    productos.forEach(p => m.set(p.id, p.nombre));
    return m;
  }, [productos]);

  const irPaso2 = () => {
    setError(null);
    if (!entradaId) { setError('Elige el material de entrada.'); return; }
    if (entradaNum <= 0) { setError('Ingresa una cantidad de entrada mayor a 0.'); return; }
    if (entradaNum > stockEntrada + 1e-9) { setError(`Solo hay ${fmt(stockEntrada)} kg disponibles.`); return; }
    setPaso(2);
  };

  const setSalida = (idx: number, campo: keyof SalidaForm, valor: string) =>
    setSalidas(prev => prev.map((s, i) => (i === idx ? { ...s, [campo]: valor } : s)));
  const addSalida = () => setSalidas(prev => [...prev, { materialSalidaId: '', cantidad: '' }]);
  const removeSalida = (idx: number) => setSalidas(prev => prev.filter((_, i) => i !== idx));

  const reset = () => {
    setPaso(1);
    setEntradaId('');
    setCantidadEntrada('');
    setFecha(hoyISO());
    setNotas('');
    setSalidas([{ materialSalidaId: '', cantidad: '' }]);
    setError(null);
  };

  const confirmar = async () => {
    setError(null);
    const detalles = salidas
      .filter(s => s.materialSalidaId && Number(s.cantidad) > 0)
      .map(s => ({ materialSalidaId: s.materialSalidaId, cantidad: Number(s.cantidad) }));
    if (detalles.length === 0) { setError('Agrega al menos un material de salida con cantidad.'); return; }
    if (merma < -1e-9) { setError('La suma de salidas no puede superar la entrada.'); return; }

    setGuardando(true);
    const result = await crearTransformacion({
      materialEntradaId: entradaId,
      cantidadEntrada: entradaNum,
      fecha,
      notas: notas.trim() || null,
      detalles,
    });
    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    toast.exito('Transformación registrada.');
    reset();
    cargarDatos();
  };

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Transformaciones</h1>
        <p className="text-sm text-text-secondary mt-1">
          Procesa un material y obtén varios. Descuenta la entrada del inventario y suma las salidas.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Asistente */}
        {puedeCrear ? (
          <div className="bg-surface rounded-xl border border-border p-5 h-fit">
            {/* Indicador de pasos */}
            <div className="flex items-center gap-2 mb-5 text-xs">
              <span className={`px-2 py-1 rounded-full ${paso === 1 ? 'bg-brand-600 text-white' : 'bg-surface-alt text-text-muted'}`}>1. Material que entra</span>
              <ArrowRight size={14} className="text-text-muted" />
              <span className={`px-2 py-1 rounded-full ${paso === 2 ? 'bg-brand-600 text-white' : 'bg-surface-alt text-text-muted'}`}>2. Materiales que salen</span>
            </div>

            {paso === 1 ? (
              <div className="space-y-4">
                <div>
                  <label className={labelClass}>Material de entrada *</label>
                  <select value={entradaId} onChange={e => setEntradaId(e.target.value)} className={inputClass}>
                    <option value="">— Selecciona —</option>
                    {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                  {entradaId && (
                    <p className="text-xs text-text-muted mt-1">
                      Stock disponible: <span className={stockEntrada < 0 ? 'text-red-600 font-medium' : 'font-medium'}>{fmt(stockEntrada)} kg</span>
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Cantidad (kg) *</label>
                    <input type="number" step="0.01" min="0" max={stockEntrada} value={cantidadEntrada} onChange={e => setCantidadEntrada(e.target.value)} className={inputClass} placeholder="0.00" />
                  </div>
                  <div>
                    <label className={labelClass}>Fecha</label>
                    <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className={inputClass} />
                  </div>
                </div>

                {error && <p className="text-red-500 text-sm">{error}</p>}

                <button type="button" onClick={irPaso2} className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors">
                  Siguiente <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-brand-50 border border-brand-200 rounded-lg px-4 py-2.5 text-sm text-brand-800">
                  Entra: <span className="font-semibold">{fmt(entradaNum)} kg</span> de {nombrePorProducto.get(entradaId) ?? 'material'}
                </div>

                <div className="space-y-2">
                  <label className={labelClass}>Materiales que salen</label>
                  {salidas.map((s, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <select value={s.materialSalidaId} onChange={e => setSalida(idx, 'materialSalidaId', e.target.value)} className={inputClass}>
                        <option value="">— Material —</option>
                        {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                      </select>
                      <input type="number" step="0.01" min="0" value={s.cantidad} onChange={e => setSalida(idx, 'cantidad', e.target.value)} className="w-28 px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" placeholder="kg" />
                      {salidas.length > 1 && (
                        <button type="button" onClick={() => removeSalida(idx)} className="text-red-400 hover:text-red-600 p-1 shrink-0">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={addSalida} className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800">
                    <Plus size={14} /> Agregar material de salida
                  </button>
                </div>

                {/* Merma */}
                <div className="flex items-center justify-between bg-surface-alt rounded-lg px-4 py-2.5 text-sm">
                  <span className="text-text-secondary">Merma (no explicada)</span>
                  <span className={`font-bold ${merma < -1e-9 ? 'text-red-600' : 'text-text-primary'}`}>{fmt(merma)} kg</span>
                </div>

                <div>
                  <label className={labelClass}>Notas</label>
                  <textarea value={notas} onChange={e => setNotas(e.target.value)} className={`${inputClass} resize-none`} rows={2} placeholder="Opcional" />
                </div>

                {error && <p className="text-red-500 text-sm">{error}</p>}

                <div className="flex gap-3">
                  <button type="button" onClick={() => { setPaso(1); setError(null); }} className="flex items-center justify-center gap-1.5 px-4 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
                    <ArrowLeft size={16} /> Atrás
                  </button>
                  <button type="button" onClick={confirmar} disabled={guardando} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
                    {guardando ? <><Loader2 size={16} className="animate-spin" /> Registrando...</> : 'Confirmar transformación'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-text-muted text-sm">No tienes permiso para registrar transformaciones.</p>
        )}

        {/* Historial */}
        <div>
          <h2 className="text-sm font-semibold text-text-secondary mb-3">Historial</h2>
          <div className="space-y-2">
            {historial.length === 0 ? (
              <div className="bg-surface rounded-xl border border-border">
                <p className="text-center text-text-muted py-10 text-sm">Aún no hay transformaciones.</p>
              </div>
            ) : (
              historial.map(t => (
                <div key={t.id} className="bg-surface rounded-xl border border-border p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 shrink-0">
                      <Recycle size={14} />
                    </div>
                    <span className="text-sm font-medium text-text-primary">{fmt(t.cantidadEntrada)} kg de {t.nombreEntrada}</span>
                    <span className="text-xs text-text-muted ml-auto">{t.fecha ?? t.createdAt.slice(0, 10)}</span>
                  </div>
                  <div className="pl-9 text-xs text-text-secondary space-y-0.5">
                    {t.salidas.map((s, i) => (
                      <div key={i} className="flex justify-between">
                        <span>→ {s.nombre}</span>
                        <span className="font-medium">{fmt(s.cantidad)} kg</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-text-muted pt-1 border-t border-border mt-1">
                      <span>Merma</span>
                      <span>{fmt(t.merma)} kg</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default TransformacionesPage;
