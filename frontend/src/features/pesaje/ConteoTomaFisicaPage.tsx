import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronDown, Trash2 } from 'lucide-react';
import { obtenerTomaFisica, registrarPesajeTomaFisica, eliminarPesajeTomaFisica } from '../../services/toma-fisica-service';
import { obtenerProductos } from '../../services/producto-service';
import { obtenerLotes } from '../../services/lote-service';
import { obtenerTaras } from '../../services/tara-service';
import { subirFotosFila, taraKgFila, seleccionarTaraFila, taraVacia, type CampoTara, type FotoMaterial } from './material-fila';
import FotoMaterialPicker from './FotoMaterialPicker';
import SeleccionarMaterialModal from './SeleccionarMaterialModal';
import SeleccionarTaraModal from './SeleccionarTaraModal';
import { useToast } from '../../hooks/use-toast-context';
import type { TomaFisicaInventario, DetalleTomaFisica, Producto, Lote, Tara } from '@shared/types/index.js';

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ConteoTomaFisicaPage() {
  const { tomaFisicaId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [tomaFisica, setTomaFisica] = useState<TomaFisicaInventario | null>(null);
  const [detalle, setDetalle] = useState<DetalleTomaFisica[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [taras, setTaras] = useState<Tara[]>([]);
  const [cargando, setCargando] = useState(true);

  const [productoId, setProductoId] = useState('');
  const [loteId, setLoteId] = useState('');
  const [pesoBruto, setPesoBruto] = useState('');
  const [campoTara, setCampoTara] = useState<CampoTara>(taraVacia());
  const [fotos, setFotos] = useState<FotoMaterial[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [mostrarSelectorMaterial, setMostrarSelectorMaterial] = useState(false);
  const [mostrarSelectorTara, setMostrarSelectorTara] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = () => {
    setCargando(true);
    Promise.all([obtenerTomaFisica(tomaFisicaId), obtenerProductos(), obtenerLotes(), obtenerTaras()]).then(([res, prods, lts, tars]) => {
      if (res) { setTomaFisica(res.tomaFisica); setDetalle(res.detalle); }
      setProductos(prods);
      setLotes(lts);
      setTaras(tars.filter(t => t.activo));
      setCargando(false);
    });
  };

  useEffect(() => { cargar(); }, [tomaFisicaId]);

  // Si esta toma física ya se culminó (ej. en otra pestaña, o volviendo con
  // el botón atrás del navegador a un enlace viejo), no tiene sentido dejar
  // al usuario en un formulario muerto — lo mandamos directo al resultado.
  useEffect(() => {
    if (tomaFisica && tomaFisica.estado !== 'abierta') {
      toast.info(`${tomaFisica.codigo} ya fue culminada — te llevamos al resultado.`);
      navigate(`/inventario/toma-fisica/${tomaFisicaId}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tomaFisica]);

  // Solo materiales de las categorías elegidas para esta toma física.
  const productosDisponibles = useMemo(
    () => productos.filter(p => p.activo && tomaFisica?.categoriaIds.includes(p.tipoMaterialId ?? '')),
    [productos, tomaFisica]
  );
  const productoSel = productosDisponibles.find(p => p.id === productoId);
  // Solo pide lote cuando el material es de una categoría con lote — y solo
  // entre los lotes de esta toma física (si se acotó a lotes específicos al
  // crearla) o todos los del almacén (si no se acotó).
  const requiereLote = productoSel != null && productoSel.tipoMaterialSinLote !== true;
  const lotesDelAlmacen = useMemo(
    () => lotes.filter(l =>
      l.activo
      && l.almacenId === tomaFisica?.almacenId
      && (!tomaFisica?.loteIds.length || tomaFisica.loteIds.includes(l.id))
    ),
    [lotes, tomaFisica]
  );

  const loteSeleccionado = loteId ? lotes.find(l => l.id === loteId) ?? null : null;
  const netoActual = (Number(pesoBruto) || 0) - taraKgFila(campoTara, taras);

  const agregarFotos = (files: File[]) =>
    setFotos(prev => [...prev, ...files.map(file => ({ tipo: 'nueva' as const, file, preview: URL.createObjectURL(file) }))]);
  const quitarFoto = (idx: number) => setFotos(prev => prev.filter((_, i) => i !== idx));

  const handleAgregar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!productoId) { setError('Elige un material.'); return; }
    if (requiereLote && !loteId) { setError('Elige el lote donde está este material.'); return; }
    if (netoActual <= 0) { setError('El peso neto debe ser mayor a 0.'); return; }
    if (fotos.length === 0) { setError('Agrega al menos una foto.'); return; }

    setGuardando(true);
    const urls = await subirFotosFila(fotos);
    if (!urls) {
      setGuardando(false);
      setError('No se pudo subir una de las fotos. Revisa que el bucket "tickets" exista en Supabase Storage.');
      return;
    }
    const result = await registrarPesajeTomaFisica(tomaFisicaId, {
      productoId,
      loteId: requiereLote ? loteId : null,
      pesoBruto: Number(pesoBruto) || 0,
      tara: taraKgFila(campoTara, taras),
      fotos: urls,
    });
    setGuardando(false);
    if ('error' in result) { setError(result.error); return; }

    toast.exito('Pesaje registrado.');
    setPesoBruto('');
    setCampoTara(taraVacia());
    setFotos([]);
    setLoteId('');
    cargar();
  };

  const handleQuitar = async (detalleId: string) => {
    const result = await eliminarPesajeTomaFisica(tomaFisicaId, detalleId);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    cargar();
  };

  const inputClass = "w-full px-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  if (cargando) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!tomaFisica) {
    return <p className="text-center text-text-muted py-12 text-sm">Toma física no encontrada.</p>;
  }

  if (tomaFisica.estado !== 'abierta') {
    // Redirigiendo (ver useEffect arriba) — spinner breve en vez de un
    // formulario muerto o un mensaje que exige un clic para salir.
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <button type="button" onClick={() => navigate(`/inventario/toma-fisica/${tomaFisicaId}`)} className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors mb-4">
        <ArrowLeft size={16} />
        {tomaFisica.codigo}
      </button>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Conteo físico</h1>
        <p className="text-sm text-text-secondary mt-1">
          {tomaFisica.almacenNombre} · {tomaFisica.categoriaNombres.join(', ')} — pesaje simple, sin destino ni pesaje global.
        </p>
      </div>

      <form onSubmit={handleAgregar} className="space-y-4 bg-surface rounded-xl border border-border p-5 mb-6">
        <div>
          <label className={labelClass}>Material *</label>
          <button
            type="button"
            onClick={() => setMostrarSelectorMaterial(true)}
            className={`${inputClass} flex items-center justify-between gap-2 text-left`}
          >
            <span className={productoId ? 'text-text-primary truncate' : 'text-text-muted'}>
              {productosDisponibles.find(p => p.id === productoId)?.nombre ?? '— Selecciona —'}
            </span>
            <ChevronDown size={14} className="text-text-muted shrink-0" />
          </button>
        </div>

        {requiereLote && (
          <div>
            <label className={labelClass}>Lote *</label>
            <select value={loteId} onChange={e => setLoteId(e.target.value)} className={inputClass}>
              <option value="">Selecciona…</option>
              {lotesDelAlmacen.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
            </select>
            {lotesDelAlmacen.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">Este almacén no tiene lotes activos todavía.</p>
            )}
            {loteSeleccionado && loteSeleccionado.composicion.length > 0 && (
              <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                <p className="text-[11px] font-medium text-amber-800 mb-1.5">
                  Composición estimada de este lote (referencial — no se altera al contar):
                </p>
                <div className="flex flex-wrap gap-1">
                  {loteSeleccionado.composicion.map(c => (
                    <span key={c.item} className="text-[11px] bg-white text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
                      {c.item} · {c.porcentaje}% · ~{fmt(loteSeleccionado.stockKg * c.porcentaje / 100)} kg
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div>
          <label className={labelClass}>Peso bruto (kg) *</label>
          <input type="number" step="0.001" min="0" value={pesoBruto} onChange={e => setPesoBruto(e.target.value)} className={inputClass} placeholder="0.00" />
        </div>

        <div>
          <label className={labelClass}>Tara</label>
          <div className="flex rounded-md overflow-hidden border border-border text-[11px] w-fit mb-1.5">
            <button type="button" onClick={() => setCampoTara(prev => ({ ...prev, taraModo: 'preconfigurada' }))} className={`px-2 py-1 ${campoTara.taraModo === 'preconfigurada' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
              Preconfigurada
            </button>
            <button type="button" onClick={() => setCampoTara(prev => ({ ...prev, taraModo: 'manual' }))} className={`px-2 py-1 ${campoTara.taraModo === 'manual' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
              Manual
            </button>
          </div>
          {campoTara.taraModo === 'preconfigurada' ? (
            <div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMostrarSelectorTara(true)}
                  className={`${inputClass} flex items-center justify-between gap-2 text-left`}
                >
                  <span className={campoTara.taraId ? 'text-text-primary truncate' : 'text-text-muted'}>
                    {taras.find(t => t.id === campoTara.taraId)?.nombre ?? '— Sin tara —'}
                  </span>
                  <ChevronDown size={14} className="text-text-muted shrink-0" />
                </button>
                <input type="number" step="1" min="0" value={campoTara.taraCantidad} onChange={e => setCampoTara(prev => ({ ...prev, taraCantidad: e.target.value }))} className={inputClass} placeholder="Cantidad" />
              </div>
              <p className="text-[11px] text-text-muted mt-1">= {fmt(taraKgFila(campoTara, taras))} kg</p>
            </div>
          ) : (
            <input type="number" step="0.001" min="0" value={campoTara.taraManual} onChange={e => setCampoTara(prev => ({ ...prev, taraManual: e.target.value }))} className={inputClass} placeholder="0.00" />
          )}
        </div>

        {netoActual > 0 && (
          <p className="text-sm text-text-secondary">Neto: <span className="font-semibold text-text-primary">{fmt(netoActual)} kg</span></p>
        )}

        <FotoMaterialPicker fotos={fotos} onAgregar={agregarFotos} onQuitar={quitarFoto} label="Fotos" />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={guardando} className="w-full py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
          {guardando ? 'Registrando…' : 'Agregar pesaje'}
        </button>
      </form>

      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">Pesajes registrados ({detalle.length})</h2>
        </div>
        {detalle.length === 0 ? (
          <p className="px-5 py-6 text-center text-text-muted text-sm">Todavía no registraste ningún pesaje.</p>
        ) : (
          <div className="divide-y divide-border">
            {detalle.map(d => (
              <div key={d.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <div className="flex-1 min-w-0">
                  <span className="text-text-primary">{d.nombreProducto}</span>
                  {d.nombreLote && <span className="text-text-muted"> · {d.nombreLote}</span>}
                </div>
                <span className="font-semibold text-text-primary shrink-0">{fmt(d.pesoNeto)} kg</span>
                <button type="button" onClick={() => handleQuitar(d.id)} className="text-text-muted hover:text-red-600 transition-colors shrink-0" title="Quitar">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {mostrarSelectorMaterial && (
        <SeleccionarMaterialModal
          productos={productosDisponibles}
          onClose={() => setMostrarSelectorMaterial(false)}
          onSeleccionar={id => { setProductoId(id); setLoteId(''); setMostrarSelectorMaterial(false); }}
        />
      )}
      {mostrarSelectorTara && (
        <SeleccionarTaraModal
          taras={taras}
          taraSeleccionada={campoTara.taraId || undefined}
          onClose={() => setMostrarSelectorTara(false)}
          onSeleccionar={taraId => { setCampoTara(prev => ({ ...prev, ...seleccionarTaraFila(prev, taraId) })); setMostrarSelectorTara(false); }}
        />
      )}
    </div>
  );
}

export default ConteoTomaFisicaPage;
