import { useEffect, useState } from 'react';
import { Plus, Boxes, Loader2, X, Layers } from 'lucide-react';
import { obtenerLotes, crearLote, actualizarLote } from '../../services/lote-service';
import { obtenerAlmacenes } from '../../services/almacen-service';
import { subirFotoLote } from '../../services/storage-service';
import { fotoLocalDeFile, subirFotosLocal, type FotoLocal } from '../../lib/foto-picker';
import FotoMultiplePicker from '../../components/FotoMultiplePicker';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import type { Lote, Almacen, ComposicionPCBItem } from '@shared/types/index.js';

const PCB_ITEMS_PREDEFINIDOS = [
  'CENTRALES', 'DD', 'PP', 'SLOT', 'FILO DORADO', 'MEMORIA DORADA',
  'PLATEADA', 'MIXTO 1', 'PPBA', 'PROCESADOR', 'CERÁMICO',
];

function EditorComposicionModal({ lote, onClose, onGuardada }: {
  lote: Lote;
  onClose: () => void;
  onGuardada: () => void;
}) {
  const toast = useToast();
  const inputClass = "px-2 py-1.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400";

  const [items, setItems] = useState<ComposicionPCBItem[]>(() =>
    lote.composicion.length > 0 ? lote.composicion : []
  );
  const [itemCustom, setItemCustom] = useState('');
  const [guardando, setGuardando] = useState(false);

  const suma = items.reduce((acc, c) => acc + (Number(c.porcentaje) || 0), 0);

  const agregarItem = (nombre: string) => {
    const n = nombre.trim().toUpperCase();
    if (!n || items.some(i => i.item === n)) return;
    setItems(prev => [...prev, { item: n, porcentaje: 0 }]);
    setItemCustom('');
  };

  const actualizarPct = (item: string, val: string) => {
    setItems(prev => prev.map(c => c.item === item ? { ...c, porcentaje: Math.min(100, Math.max(0, Number(val) || 0)) } : c));
  };

  const quitarItem = (item: string) => setItems(prev => prev.filter(c => c.item !== item));

  const handleGuardar = async () => {
    setGuardando(true);
    const result = await actualizarLote(lote.id, { composicion: items.filter(c => c.porcentaje > 0) });
    setGuardando(false);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito('Composición guardada.');
    onGuardada();
  };

  const disponibles = PCB_ITEMS_PREDEFINIDOS.filter(p => !items.some(i => i.item === p));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-surface rounded-xl border border-border w-full max-w-md my-8 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-text-primary">Composición PCB</h2>
            <p className="text-xs text-text-muted mt-0.5">{lote.nombre}</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
        </div>

        {items.length > 0 && (
          <div className="space-y-2 mb-4">
            {items.map(c => (
              <div key={c.item} className="flex items-center gap-2">
                <span className="flex-1 text-sm text-text-primary truncate">{c.item}</span>
                <input
                  type="number" min="0" max="100" step="0.1"
                  value={c.porcentaje}
                  onChange={e => actualizarPct(c.item, e.target.value)}
                  className={`${inputClass} w-20 text-right`}
                />
                <span className="text-xs text-text-muted">%</span>
                <button type="button" onClick={() => quitarItem(c.item)} className="text-text-muted hover:text-red-500 shrink-0">
                  <X size={14} />
                </button>
              </div>
            ))}
            <div className={`flex justify-between text-xs font-medium pt-1 border-t border-border ${Math.abs(suma - 100) > 0.1 ? 'text-amber-600' : 'text-green-600'}`}>
              <span>Total</span><span>{suma.toFixed(1)}%</span>
            </div>
          </div>
        )}

        {disponibles.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-medium text-text-secondary mb-2">Agregar ítem predefinido</p>
            <div className="flex flex-wrap gap-1.5">
              {disponibles.map(p => (
                <button key={p} type="button" onClick={() => agregarItem(p)}
                  className="text-xs px-2 py-1 bg-surface-alt border border-border rounded-full hover:border-brand-400 hover:text-brand-600 transition-colors">
                  + {p}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 mb-4">
          <input
            type="text" value={itemCustom} onChange={e => setItemCustom(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); agregarItem(itemCustom); } }}
            placeholder="Ítem personalizado..."
            className={`${inputClass} flex-1`}
          />
          <button type="button" onClick={() => agregarItem(itemCustom)}
            className="px-3 py-1.5 bg-surface-alt border border-border rounded-lg text-sm hover:border-brand-400 transition-colors">
            <Plus size={14} />
          </button>
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm text-text-secondary hover:bg-surface-alt transition-colors">
            Cancelar
          </button>
          <button onClick={handleGuardar} disabled={guardando}
            className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {guardando ? <><Loader2 size={14} className="animate-spin" /> Guardando...</> : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function LotesPage() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const puedeCrear = tienePermiso('productos', 'crear');
  const puedeEditar = tienePermiso('productos', 'editar');

  const [lotes, setLotes] = useState<Lote[]>([]);
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [cargando, setCargando] = useState(true);
  const [nombre, setNombre] = useState('');
  const [almacenId, setAlmacenId] = useState('');
  const [fotosNuevoLote, setFotosNuevoLote] = useState<FotoLocal[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [editandoComposicion, setEditandoComposicion] = useState<Lote | null>(null);

  const recargar = () => obtenerLotes().then(setLotes).finally(() => setCargando(false));
  const cargar = () => { setCargando(true); recargar(); };

  useEffect(() => {
    recargar();
    obtenerAlmacenes().then(lista => {
      const activos = lista.filter(a => a.activo);
      setAlmacenes(activos);
      setAlmacenId(prev => prev || activos.find(a => a.esPredeterminado)?.id || activos[0]?.id || '');
    });
  }, []);

  const handleCrear = async (e: React.FormEvent) => {
    e.preventDefault();
    const limpio = nombre.trim();
    if (!limpio || !almacenId) return;
    setGuardando(true);
    const urls = await subirFotosLocal(fotosNuevoLote, subirFotoLote);
    if (!urls) { toast.errorMsg('Error al subir una de las fotos.'); setGuardando(false); return; }
    const result = await crearLote(limpio, almacenId, urls);
    setGuardando(false);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`Lote "${result.lote.nombre}" creado.`);
    setNombre('');
    setFotosNuevoLote([]);
    cargar();
  };

  const toggleActivo = async (l: Lote) => {
    const result = await actualizarLote(l.id, { activo: !l.activo });
    if ('error' in result) { toast.errorMsg(result.error); return; }
    cargar();
  };

  const cambiarAlmacen = async (l: Lote, nuevoAlmacenId: string) => {
    if (nuevoAlmacenId === l.almacenId) return;
    const result = await actualizarLote(l.id, { almacenId: nuevoAlmacenId });
    if ('error' in result) { toast.errorMsg(result.error); return; }
    cargar();
  };

  const inputClass = "px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Lotes</h1>
        <p className="text-sm text-text-secondary mt-1">
          Destinos de inventario para el material pesado. Definen dónde se acumula el
          stock de cada material.
        </p>
      </div>

      {puedeCrear && (
        <form onSubmit={handleCrear} className="flex flex-col gap-3 mb-5">
          <div className="flex flex-col sm:flex-row sm:items-end gap-2">
            <div className="flex-1">
              <label className="block text-xs font-medium text-text-secondary mb-1">Nuevo lote</label>
              <input
                type="text"
                value={nombre}
                onChange={e => setNombre(e.target.value)}
                className={`${inputClass} w-full`}
                placeholder="Ej. Lote 1"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Almacén</label>
              <select
                value={almacenId}
                onChange={e => setAlmacenId(e.target.value)}
                className={`${inputClass} w-full sm:w-auto`}
              >
                {almacenes.map(a => (
                  <option key={a.id} value={a.id}>{a.nombre}</option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={guardando || !nombre.trim() || !almacenId}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
            >
              {guardando ? <Loader2 size={16} className="animate-spin" /> : <Plus size={18} />}
              Agregar
            </button>
          </div>
          <FotoMultiplePicker
            fotos={fotosNuevoLote}
            onAgregar={files => setFotosNuevoLote(prev => [...prev, ...files.map(fotoLocalDeFile)])}
            onQuitar={idx => setFotosNuevoLote(prev => prev.filter((_, i) => i !== idx))}
            label="Fotos del lote"
          />
        </form>
      )}

      {cargando ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
        </div>
      ) : lotes.length === 0 ? (
        <p className="text-center text-text-muted py-12 text-sm">No hay lotes todavía.</p>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          {lotes.map(l => (
            <div key={l.id} className="px-4 sm:px-5 py-3.5 border-b border-border last:border-b-0">
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 shrink-0">
                  <Boxes size={16} />
                </div>
                <div className="flex-1 min-w-[8rem]">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-text-primary text-sm truncate">{l.nombre}</h3>
                    {!l.activo && (
                      <span className="px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded-full shrink-0">Inactivo</span>
                    )}
                  </div>
                  <p className={`text-xs mt-0.5 ${l.stockKg < 0 ? 'text-red-600' : 'text-text-muted'}`}>
                    {fmt(l.stockKg)} kg
                  </p>
                </div>
                {puedeEditar ? (
                  <select
                    value={l.almacenId}
                    onChange={e => cambiarAlmacen(l, e.target.value)}
                    className="text-xs bg-surface-alt border border-border rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-400 shrink-0"
                  >
                    {almacenes.map(a => (
                      <option key={a.id} value={a.id}>{a.nombre}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs text-text-muted shrink-0">{l.almacenNombre ?? '—'}</span>
                )}
                {puedeEditar && (
                  <button
                    type="button"
                    onClick={() => setEditandoComposicion(l)}
                    className="text-xs font-medium text-text-muted hover:text-brand-600 transition-colors flex items-center gap-1"
                    title="Editar composición PCB"
                  >
                    <Layers size={12} /> Composición
                  </button>
                )}
                {puedeEditar && (
                  <button
                    type="button"
                    onClick={() => toggleActivo(l)}
                    className="text-xs font-medium text-text-muted hover:text-brand-600 transition-colors"
                  >
                    {l.activo ? 'Desactivar' : 'Reactivar'}
                  </button>
                )}
              </div>
              {l.composicion.length > 0 && (
                <div className="mt-2 pl-12 flex flex-wrap gap-1">
                  {l.composicion.map(c => (
                    <span key={c.item} className="text-[11px] bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
                      {c.item}: {c.porcentaje}%
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editandoComposicion && (
        <EditorComposicionModal
          lote={editandoComposicion}
          onClose={() => setEditandoComposicion(null)}
          onGuardada={() => { setEditandoComposicion(null); cargar(); }}
        />
      )}
    </div>
  );
}

export default LotesPage;
