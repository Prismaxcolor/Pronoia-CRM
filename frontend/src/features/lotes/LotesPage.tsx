import { useEffect, useState } from 'react';
import { Plus, Boxes, Loader2 } from 'lucide-react';
import { obtenerLotes, crearLote, actualizarLote } from '../../services/lote-service';
import { obtenerAlmacenes } from '../../services/almacen-service';
import { subirFotoLote } from '../../services/storage-service';
import { fotoLocalDeFile, subirFotosLocal, type FotoLocal } from '../../lib/foto-picker';
import FotoMultiplePicker from '../../components/FotoMultiplePicker';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import type { Lote, Almacen } from '@shared/types/index.js';

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
                    onClick={() => toggleActivo(l)}
                    className="text-xs font-medium text-text-muted hover:text-brand-600 transition-colors"
                  >
                    {l.activo ? 'Desactivar' : 'Reactivar'}
                  </button>
                )}
              </div>
              {l.composicion.length > 0 && (
                // Composición calculada en vivo a partir de lo realmente
                // pesado en el lote — no es editable, nadie la declara a mano.
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
    </div>
  );
}

export default LotesPage;
