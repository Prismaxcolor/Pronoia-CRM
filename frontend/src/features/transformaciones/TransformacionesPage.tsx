import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Recycle, CheckCircle2, Clock, X, Plus, Loader2, Trash2,
  ChevronDown, ChevronUp, Camera,
} from 'lucide-react';
import {
  obtenerTransformaciones,
  borrarTransformacion,
  crearTransformacionFerroso,
  completarTransformacionFerroso,
  obtenerSalidasComunes,
  guardarSalidasComunes,
  type CrearTransformacionFerrosoInput,
  type CompletarTransformacionFerrosoSalidaInput,
} from '../../services/transformacion-service';
import { obtenerProductos } from '../../services/producto-service';
import { obtenerAlmacenes } from '../../services/almacen-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { useConfirm } from '../../hooks/use-confirm-context';
import { subirFotoTicket } from '../../services/storage-service';
import type { Transformacion, SalidaComun } from '@shared/types/index.js';
import type { Producto } from '@shared/types/index.js';
import type { Almacen } from '@shared/types/index.js';
import type { FotoMaterial } from '../pesaje/material-fila';

type Tab = 'nueva' | 'pendientes' | 'historial' | 'config';
type Categoria = 'ferroso_no_ferroso' | 'pcb';

function hoyISO() { return new Date().toISOString().slice(0, 10); }
function fmt(n: number) { return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 3 }); }

async function subirFoto(foto: FotoMaterial): Promise<string | null> {
  if (foto.tipo === 'existente') return foto.url;
  return subirFotoTicket(foto.file);
}

// ---------------------------------------------------------------------------
// Fila de salida en el formulario de completar
// ---------------------------------------------------------------------------
interface FilaSalida {
  uid: number;
  productoId: string;
  pesoBruto: string;
  tara: string;
  foto: FotoMaterial | null;
}

let nextUid = 1;
function filaVacia(productoId = ''): FilaSalida {
  return { uid: nextUid++, productoId, pesoBruto: '', tara: '', foto: null };
}

// ---------------------------------------------------------------------------
// Modal: Completar transformación ferroso
// ---------------------------------------------------------------------------
function CompletarFerrosoModal({
  transformacion,
  productos,
  salidasComunes,
  onClose,
  onCompletada,
}: {
  transformacion: Transformacion;
  productos: Producto[];
  salidasComunes: SalidaComun[];
  onClose: () => void;
  onCompletada: () => void;
}) {
  const toast = useToast();
  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  const comunesIds = salidasComunes.map(s => s.productoSalidaId);

  const [filas, setFilas] = useState<FilaSalida[]>(() =>
    comunesIds.length > 0
      ? comunesIds.map(id => filaVacia(id))
      : [filaVacia()]
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actualizar = (uid: number, campo: Partial<FilaSalida>) => {
    setFilas(prev => prev.map(f => f.uid === uid ? { ...f, ...campo } : f));
  };

  const productosSorted = (id?: string): Producto[] => {
    const comunes = productos.filter(p => comunesIds.includes(p.id));
    const resto = productos.filter(p => !comunesIds.includes(p.id));
    if (id && comunesIds.includes(id)) return [productos.find(p => p.id === id)!, ...comunes.filter(p => p.id !== id), ...resto];
    return [...comunes, ...resto];
  };

  const totalSalidas = filas.reduce((acc, f) => acc + (Number(f.pesoBruto) - Number(f.tara || 0)), 0);
  const merma = transformacion.pesoNeto - totalSalidas;

  const handleCompletar = async () => {
    setError(null);
    if (filas.some(f => !f.productoId)) { setError('Todos los materiales de salida necesitan un producto.'); return; }
    if (filas.some(f => (Number(f.pesoBruto) - Number(f.tara || 0)) <= 0)) {
      setError('Cada salida debe tener peso neto mayor a 0.');
      return;
    }

    setGuardando(true);
    const salidaInputs: CompletarTransformacionFerrosoSalidaInput[] = [];
    for (const f of filas) {
      const fotoUrl = f.foto ? await subirFoto(f.foto) : null;
      salidaInputs.push({
        productoId: f.productoId,
        pesoBruto: Number(f.pesoBruto),
        tara: Number(f.tara || 0),
        fotos: fotoUrl ? [fotoUrl] : [],
      });
    }

    const result = await completarTransformacionFerroso(transformacion.id, salidaInputs);
    setGuardando(false);
    if ('error' in result) { setError(result.error); return; }
    toast.exito('Transformación completada.');
    onCompletada();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-surface rounded-xl border border-border w-full max-w-xl my-8 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-text-primary">Completar transformación</h2>
            <p className="text-xs text-text-muted mt-0.5">
              Entrada: <span className="font-medium">{transformacion.nombreProductoEntrada}</span> — {fmt(transformacion.pesoNeto)} kg
            </p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
        </div>

        <div className="space-y-3 mb-4">
          {filas.map((f, idx) => (
            <div key={f.uid} className="bg-surface-alt rounded-lg p-3 border border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-text-secondary">Salida {idx + 1}</span>
                {filas.length > 1 && (
                  <button type="button" onClick={() => setFilas(prev => prev.filter(x => x.uid !== f.uid))} className="text-text-muted hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <div className="space-y-2">
                <div>
                  <label className={labelClass}>Material *</label>
                  <select value={f.productoId} onChange={e => actualizar(f.uid, { productoId: e.target.value })} className={inputClass}>
                    <option value="" disabled>-Selecciona-</option>
                    {comunesIds.length > 0 && (
                      <optgroup label="— Comunes —">
                        {productos.filter(p => comunesIds.includes(p.id)).map(p => (
                          <option key={p.id} value={p.id}>{p.nombre}</option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="— Todos —">
                      {productos.filter(p => !comunesIds.includes(p.id)).map(p => (
                        <option key={p.id} value={p.id}>{p.nombre}</option>
                      ))}
                    </optgroup>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelClass}>Peso bruto (kg) *</label>
                    <input type="number" step="0.001" min="0.001" value={f.pesoBruto}
                      onChange={e => actualizar(f.uid, { pesoBruto: e.target.value })}
                      className={inputClass} placeholder="0.00" />
                  </div>
                  <div>
                    <label className={labelClass}>Tara (kg)</label>
                    <input type="number" step="0.01" min="0" value={f.tara}
                      onChange={e => actualizar(f.uid, { tara: e.target.value })}
                      className={inputClass} placeholder="0.00" />
                  </div>
                </div>
                <p className="text-xs text-text-muted">
                  Neto: <span className="font-semibold text-text-primary">{fmt((Number(f.pesoBruto) || 0) - (Number(f.tara) || 0))} kg</span>
                </p>
                <FotoMiniaturas
                  fotos={f.foto ? [f.foto] : []}
                  onAgregar={files => {
                    if (files[0]) {
                      const preview = URL.createObjectURL(files[0]);
                      actualizar(f.uid, { foto: { tipo: 'nueva', file: files[0], preview } });
                    }
                  }}
                  onQuitar={() => actualizar(f.uid, { foto: null })}
                />
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setFilas(prev => [...prev, filaVacia()])}
          className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-border rounded-lg text-sm text-text-muted hover:text-text-secondary hover:border-brand-400 transition-colors mb-4"
        >
          <Plus size={14} /> Agregar material de salida
        </button>

        <div className="bg-surface-alt rounded-lg p-3 mb-4 text-xs space-y-1 border border-border">
          <div className="flex justify-between text-text-secondary"><span>Entrada total</span><span className="font-medium">{fmt(transformacion.pesoNeto)} kg</span></div>
          <div className="flex justify-between text-text-secondary"><span>Salidas totales</span><span className="font-medium">{fmt(totalSalidas)} kg</span></div>
          <div className={`flex justify-between font-medium ${merma < 0 ? 'text-red-600' : 'text-text-muted'}`}>
            <span>Merma</span><span>{fmt(merma)} kg</span>
          </div>
        </div>

        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm text-text-secondary hover:bg-surface-alt transition-colors">
            Cancelar
          </button>
          <button onClick={handleCompletar} disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {guardando ? <><Loader2 size={15} className="animate-spin" /> Guardando...</> : 'Completar transformación'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sección de configuración: salidas comunes por producto de entrada
// ---------------------------------------------------------------------------
function ConfigSalidasComunes({
  productos,
  salidasComunes,
  onSaved,
}: {
  productos: Producto[];
  salidasComunes: SalidaComun[];
  onSaved: () => void;
}) {
  const toast = useToast();
  const [productoEntradaId, setProductoEntradaId] = useState('');
  const [seleccionados, setSeleccionados] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);
  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  useEffect(() => {
    if (!productoEntradaId) { setSeleccionados([]); return; }
    const ids = salidasComunes.filter(s => s.productoEntradaId === productoEntradaId).map(s => s.productoSalidaId);
    setSeleccionados(ids);
  }, [productoEntradaId, salidasComunes]);

  const toggle = (id: string) => {
    setSeleccionados(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const guardar = async () => {
    if (!productoEntradaId) return;
    setGuardando(true);
    const result = await guardarSalidasComunes(productoEntradaId, seleccionados);
    setGuardando(false);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito('Configuración guardada.');
    onSaved();
  };

  const nombreEntrada = productos.find(p => p.id === productoEntradaId)?.nombre;
  const productosSalida = productos.filter(p => p.id !== productoEntradaId);

  return (
    <div className="max-w-md space-y-4">
      <div>
        <label className={labelClass}>Material de entrada</label>
        <select value={productoEntradaId} onChange={e => setProductoEntradaId(e.target.value)} className={inputClass}>
          <option value="" disabled>Selecciona el material que entra a la transformación</option>
          {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>

      {productoEntradaId && (
        <>
          <div>
            <label className={labelClass}>Materiales que habitualmente salen de {nombreEntrada}</label>
            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {productosSalida.map(p => (
                <label key={p.id} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-surface-alt cursor-pointer">
                  <input
                    type="checkbox"
                    checked={seleccionados.includes(p.id)}
                    onChange={() => toggle(p.id)}
                    className="rounded border-border accent-brand-600"
                  />
                  <span className="text-sm text-text-primary">{p.nombre}</span>
                </label>
              ))}
            </div>
          </div>
          <button
            onClick={guardar}
            disabled={guardando}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
          >
            {guardando ? <Loader2 size={14} className="animate-spin" /> : null}
            Guardar configuración
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulario: Nueva transformación ferroso
// ---------------------------------------------------------------------------
function NuevaFerrosoForm({
  productos,
  almacenes,
  onCreada,
}: {
  productos: Producto[];
  almacenes: Almacen[];
  onCreada: () => void;
}) {
  const toast = useToast();
  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  const [productoEntradaId, setProductoEntradaId] = useState('');
  const [almacenId, setAlmacenId] = useState('');
  const [pesoBruto, setPesoBruto] = useState('');
  const [tara, setTara] = useState('');
  const [fotos, setFotos] = useState<FotoMaterial[]>([]);
  const [fecha, setFecha] = useState(hoyISO());
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const neto = (Number(pesoBruto) || 0) - (Number(tara) || 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!productoEntradaId) { setError('Selecciona el material de entrada.'); return; }
    if (!almacenId) { setError('Selecciona el almacén.'); return; }
    if (neto <= 0) { setError('El peso neto debe ser mayor a 0.'); return; }

    setGuardando(true);
    const fotosUrls: string[] = [];
    for (const foto of fotos) {
      const url = await subirFoto(foto);
      if (url) fotosUrls.push(url);
    }

    const input: CrearTransformacionFerrosoInput = {
      productoEntradaId,
      almacenId,
      pesoBruto: Number(pesoBruto),
      tara: Number(tara) || 0,
      fecha,
      notas: notas.trim() || null,
      fotosEntrada: fotosUrls,
    };
    const result = await crearTransformacionFerroso(input);
    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    toast.exito('Transformación iniciada. Complétala cuando tengas las salidas pesadas.');
    setProductoEntradaId('');
    setAlmacenId('');
    setPesoBruto('');
    setTara('');
    setFotos([]);
    setFecha(hoyISO());
    setNotas('');
    onCreada();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
      <div>
        <label className={labelClass}>Material de entrada *</label>
        <select required value={productoEntradaId} onChange={e => setProductoEntradaId(e.target.value)} className={inputClass}>
          <option value="" disabled>-Selecciona el material a transformar-</option>
          {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>

      <div>
        <label className={labelClass}>Almacén de origen *</label>
        <select required value={almacenId} onChange={e => setAlmacenId(e.target.value)} className={inputClass}>
          <option value="" disabled>-Selecciona el almacén-</option>
          {almacenes.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Peso bruto (kg) *</label>
          <input type="number" step="0.001" min="0.001" required value={pesoBruto}
            onChange={e => setPesoBruto(e.target.value)} className={inputClass} placeholder="0.00" />
        </div>
        <div>
          <label className={labelClass}>Tara (kg)</label>
          <input type="number" step="0.01" min="0" value={tara}
            onChange={e => setTara(e.target.value)} className={inputClass} placeholder="0.00" />
        </div>
      </div>

      <p className="text-xs text-text-muted -mt-2">
        Neto a retirar: <span className="font-semibold text-text-primary">{fmt(neto)} kg</span>
      </p>

      <FotoMultiplePicker fotos={fotos} setFotos={setFotos} label="Fotos de entrada (opcional)" />

      <div>
        <label className={labelClass}>Fecha</label>
        <input type="date" required value={fecha} onChange={e => setFecha(e.target.value)} className={inputClass} />
      </div>

      <div>
        <label className={labelClass}>Notas <span className="text-text-muted">(opcional)</span></label>
        <textarea value={notas} onChange={e => setNotas(e.target.value)}
          className={`${inputClass} resize-none`} rows={2} />
      </div>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      <button type="submit" disabled={guardando}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
        {guardando ? <><Loader2 size={15} className="animate-spin" /> Registrando...</> : 'Iniciar transformación'}
      </button>
    </form>
  );
}

// Picker de una foto con miniatura (para la fila de salida del modal)
function FotoMiniaturas({
  fotos,
  onAgregar,
  onQuitar,
}: {
  fotos: FotoMaterial[];
  onAgregar: (files: File[]) => void;
  onQuitar: (idx: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onAgregar([file]);
    e.target.value = '';
  };
  const preview = (f: FotoMaterial) => f.tipo === 'nueva' ? f.preview : f.url;
  return (
    <div className="flex items-center gap-2">
      {fotos.map((f, i) => (
        <div key={i} className="relative w-12 h-12 rounded-lg overflow-hidden border border-border group">
          <img src={preview(f)} alt="" className="w-full h-full object-cover" />
          <button type="button" onClick={() => onQuitar(i)} className="absolute inset-0 bg-black/50 hidden group-hover:flex items-center justify-center">
            <X size={12} className="text-white" />
          </button>
        </div>
      ))}
      {fotos.length === 0 && (
        <button type="button" onClick={() => inputRef.current?.click()} className="w-12 h-12 rounded-lg border-2 border-dashed border-border flex items-center justify-center text-text-muted hover:border-brand-400 hover:text-brand-500 transition-colors text-xs">
          <Camera size={14} />
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  );
}

// Picker de múltiples fotos (simple — una a la vez, lista de miniaturas)
function FotoMultiplePicker({
  fotos,
  setFotos,
  label,
}: {
  fotos: FotoMaterial[];
  setFotos: React.Dispatch<React.SetStateAction<FotoMaterial[]>>;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const preview = URL.createObjectURL(file);
    setFotos(prev => [...prev, { tipo: 'nueva', file, preview }]);
    e.target.value = '';
  };
  return (
    <div>
      {label && <label className="block text-xs font-medium text-text-secondary mb-1">{label}</label>}
      <div className="flex flex-wrap gap-2 mb-2">
        {fotos.map((f, i) => (
          <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-border group">
            <img src={f.tipo === 'nueva' ? f.preview : f.url} alt="" className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => setFotos(prev => prev.filter((_, j) => j !== i))}
              className="absolute inset-0 bg-black/50 hidden group-hover:flex items-center justify-center"
            >
              <X size={14} className="text-white" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-16 h-16 rounded-lg border-2 border-dashed border-border flex items-center justify-center text-text-muted hover:border-brand-400 hover:text-brand-500 transition-colors"
        >
          <Camera size={18} />
        </button>
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------
function TransformacionesPage() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const puedeCrear = tienePermiso('transformaciones', 'crear');
  const puedeEliminar = tienePermiso('transformaciones', 'eliminar');

  const [tab, setTab] = useState<Tab>('nueva');
  const [categoria, setCategoria] = useState<Categoria>('ferroso_no_ferroso');

  const [transformaciones, setTransformaciones] = useState<Transformacion[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [salidasComunes, setSalidasComunes] = useState<SalidaComun[]>([]);
  const [cargando, setCargando] = useState(true);

  const [completando, setCompletando] = useState<Transformacion | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const [txs, prods, alms, comunes] = await Promise.all([
      obtenerTransformaciones({ categoria }),
      obtenerProductos(),
      obtenerAlmacenes(),
      obtenerSalidasComunes(),
    ]);
    setTransformaciones(txs);
    setProductos(prods.filter(p => p.activo));
    setAlmacenes(alms);
    setSalidasComunes(comunes);
    setCargando(false);
  }, [categoria]);

  useEffect(() => { void cargar(); }, [cargar]);

  const cancelar = async (t: Transformacion) => {
    const ok = await confirm(`¿Cancelar la transformación de ${fmt(t.pesoNeto)} kg de ${t.nombreProductoEntrada ?? t.nombreLoteOrigen}?`);
    if (!ok) return;
    const result = await borrarTransformacion(t.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito('Transformación cancelada.');
    void cargar();
  };

  const pendientes = transformaciones.filter(t => t.estado === 'bruto');
  const completas = transformaciones.filter(t => t.estado === 'completa');

  const tabBtn = (t: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(t)}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${tab === t ? 'bg-brand-600 text-white' : 'text-text-secondary hover:text-text-primary hover:bg-surface-alt'}`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-text-primary">Transformaciones</h1>
        <p className="text-sm text-text-secondary mt-1">Procesa materiales: retíralos del inventario, transforma, y registra lo que salió.</p>
      </div>

      {/* Selector de categoría */}
      <div className="flex gap-3 mb-5">
        <button
          type="button"
          onClick={() => setCategoria('ferroso_no_ferroso')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${categoria === 'ferroso_no_ferroso' ? 'bg-brand-600 text-white border-brand-600' : 'border-border text-text-secondary hover:border-brand-400 bg-surface'}`}
        >
          <Recycle size={15} /> Ferroso / No Ferroso
        </button>
        <button
          type="button"
          onClick={() => { setCategoria('pcb'); toast.errorMsg('PCB: próximamente'); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border text-sm font-medium text-text-muted bg-surface cursor-not-allowed"
          disabled
        >
          PCB <span className="text-xs bg-surface-alt px-1.5 py-0.5 rounded text-text-muted">Próximamente</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-surface-alt rounded-xl p-1 w-fit border border-border">
        {tabBtn('nueva', 'Nueva')}
        {tabBtn('pendientes', `Pendientes${pendientes.length > 0 ? ` (${pendientes.length})` : ''}`)}
        {tabBtn('historial', 'Historial')}
        {tabBtn('config', 'Configuración')}
      </div>

      {/* --- Tab: Nueva --- */}
      {tab === 'nueva' && (
        <div className="bg-surface rounded-xl border border-border p-5">
          {puedeCrear ? (
            <>
              <h2 className="text-sm font-semibold text-text-secondary mb-4">
                Nueva transformación — Ferroso / No Ferroso
              </h2>
              <NuevaFerrosoForm
                productos={productos}
                almacenes={almacenes}
                onCreada={() => { void cargar(); setTab('pendientes'); }}
              />
            </>
          ) : (
            <p className="text-text-muted text-sm">No tienes permiso para registrar transformaciones.</p>
          )}
        </div>
      )}

      {/* --- Tab: Pendientes --- */}
      {tab === 'pendientes' && (
        <div>
          {cargando ? (
            <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-text-muted" /></div>
          ) : pendientes.length === 0 ? (
            <div className="bg-surface rounded-xl border border-border p-10 text-center text-text-muted text-sm">
              No hay transformaciones pendientes.
            </div>
          ) : (
            <div className="space-y-3">
              {pendientes.map(t => (
                <div key={t.id} className="bg-surface rounded-xl border border-amber-200 p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600 shrink-0">
                      <Clock size={15} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {t.nombreProductoEntrada ?? t.nombreLoteOrigen ?? '—'} — {fmt(t.pesoNeto)} kg
                      </p>
                      <p className="text-xs text-text-muted">{t.fecha}</p>
                    </div>
                  </div>
                  <div className="flex gap-3 pl-11">
                    {puedeCrear && (
                      <button
                        type="button"
                        onClick={() => setCompletando(t)}
                        className="text-xs font-medium text-brand-600 hover:text-brand-700"
                      >
                        Completar →
                      </button>
                    )}
                    {puedeEliminar && (
                      <button
                        type="button"
                        onClick={() => cancelar(t)}
                        className="text-xs font-medium text-text-muted hover:text-red-600 flex items-center gap-0.5"
                      >
                        <X size={12} /> Cancelar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* --- Tab: Historial --- */}
      {tab === 'historial' && (
        <div>
          {cargando ? (
            <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-text-muted" /></div>
          ) : completas.length === 0 ? (
            <div className="bg-surface rounded-xl border border-border p-10 text-center text-text-muted text-sm">
              Aún no hay transformaciones completadas.
            </div>
          ) : (
            <div className="space-y-3">
              {completas.map(t => (
                <TransformacionHistorialCard key={t.id} t={t} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* --- Tab: Config --- */}
      {tab === 'config' && (
        <div className="bg-surface rounded-xl border border-border p-5">
          <h2 className="text-sm font-semibold text-text-secondary mb-1">Salidas comunes por material</h2>
          <p className="text-xs text-text-muted mb-4">
            Configura qué materiales de salida aparecen primero al completar una transformación, según el material que entró.
          </p>
          <ConfigSalidasComunes
            productos={productos}
            salidasComunes={salidasComunes}
            onSaved={() => void cargar()}
          />
        </div>
      )}

      {/* Modal completar */}
      {completando && (
        <CompletarFerrosoModal
          transformacion={completando}
          productos={productos}
          salidasComunes={salidasComunes.filter(s => s.productoEntradaId === completando.productoEntradaId)}
          onClose={() => setCompletando(null)}
          onCompletada={() => { setCompletando(null); void cargar(); setTab('historial'); }}
        />
      )}
    </div>
  );
}

// Tarjeta de historial (collapsible)
function TransformacionHistorialCard({ t }: { t: Transformacion }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 shrink-0">
          <Recycle size={15} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-primary truncate">
            {t.nombreProductoEntrada ?? t.nombreLoteOrigen ?? '—'} — {fmt(t.pesoNeto)} kg
          </p>
          <p className="text-xs text-text-muted">{t.fecha}</p>
        </div>
        <CheckCircle2 size={14} className="text-green-600 shrink-0" />
        <button type="button" onClick={() => setAbierto(v => !v)} className="text-text-muted hover:text-text-primary">
          {abierto ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>

      {!abierto && t.salidas.length > 0 && (
        <div className="pl-11 mt-2 flex flex-wrap gap-2">
          {t.salidas.map(s => (
            <span key={s.id} className="text-xs bg-surface-alt border border-border rounded-full px-2.5 py-0.5 text-text-secondary">
              {s.nombreProducto ?? s.nombreLoteDestino ?? '—'}: {fmt(s.pesoNeto)} kg
            </span>
          ))}
        </div>
      )}

      {abierto && (
        <div className="pl-11 mt-3 space-y-1.5">
          <p className="text-xs font-medium text-text-secondary mb-1">Salidas</p>
          {t.salidas.map(s => (
            <div key={s.id} className="flex justify-between text-xs text-text-secondary">
              <span>→ {s.nombreProducto ?? s.nombreLoteDestino ?? '—'}</span>
              <span className="font-medium">{fmt(s.pesoNeto)} kg</span>
            </div>
          ))}
          <div className="flex justify-between text-xs text-text-muted pt-1 border-t border-border">
            <span>Merma</span>
            <span>{fmt(t.pesoNeto - t.salidas.reduce((acc, s) => acc + s.pesoNeto, 0))} kg</span>
          </div>
          {t.notas && <p className="text-xs text-text-muted italic mt-1">"{t.notas}"</p>}
        </div>
      )}
    </div>
  );
}

export default TransformacionesPage;
