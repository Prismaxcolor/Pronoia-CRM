import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer, Pencil, Loader2, Plus, Trash2, Scale, ZoomIn, X } from 'lucide-react';
import { obtenerTicket, editarTicket } from '../../services/ticket-pesaje-service';
import { obtenerProductos } from '../../services/producto-service';
import { obtenerLotes } from '../../services/lote-service';
import { obtenerTaras } from '../../services/tara-service';
import { obtenerProveedores } from '../../services/proveedor-service';
import { obtenerClientes } from '../../services/cliente-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { filaVacia, taraKgFila, netoFila, subirFotosFila, materialAPayload, esFilaSinLote, type MaterialFila, type FotoMaterial } from './material-fila';
import FotoMaterialPicker from './FotoMaterialPicker';
import { destinoLabel, type Producto, type TicketPesaje, type Lote, type Tara } from '@shared/types/index.js';

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

/** Convierte los materiales ya guardados de un ticket en filas editables. La
 *  tara histórica se carga como manual: no se guarda qué tara preconfigurada
 *  ni cuántas unidades se usaron originalmente, solo el kg resultante. */
function filasDesdeTicket(t: TicketPesaje): MaterialFila[] {
  if (t.materiales.length === 0) return [filaVacia()];
  return t.materiales.map(m => ({
    uid: filaVacia().uid,
    productoId: m.productoId ?? '',
    subcategoria: m.subcategoria ?? '',
    pesoBruto: String(m.pesoBruto),
    taraModo: 'manual' as const,
    taraId: '',
    taraCantidad: '',
    taraManual: String(m.tara),
    destino: m.loteId ?? '',
    fotos: m.fotos.map(url => ({ tipo: 'existente' as const, url })),
  }));
}

function TicketDetallePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { tienePermiso } = useAuth();
  const toast = useToast();

  const puedeEditar = tienePermiso('pesaje', 'editar');

  const [ticket, setTicket] = useState<TicketPesaje | null>(null);
  const [cargando, setCargando] = useState(true);
  const [nombrePorEntidad, setNombrePorEntidad] = useState<Map<string, string>>(new Map());
  const [productos, setProductos] = useState<Producto[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [taras, setTaras] = useState<Tara[]>([]);

  const [editando, setEditando] = useState(false);
  const [materiales, setMateriales] = useState<MaterialFila[]>([filaVacia()]);
  const [devolucionEdit, setDevolucionEdit] = useState('');
  const [fotosDevolucionEdit, setFotosDevolucionEdit] = useState<FotoMaterial[]>([]);
  const [observacionesEdit, setObservacionesEdit] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocultarDestino, setOcultarDestino] = useState(false);
  const [fotoAmpliada, setFotoAmpliada] = useState<string | null>(null);

  const cargarTicket = () => {
    obtenerTicket(id).then(t => { setTicket(t); setCargando(false); });
  };

  useEffect(() => {
    cargarTicket();
    Promise.all([obtenerProveedores(), obtenerClientes()]).then(([proveedores, clientes]) => {
      const m = new Map<string, string>();
      [...proveedores, ...clientes].forEach(e => m.set(e.id, e.nombre));
      setNombrePorEntidad(m);
    });
    obtenerProductos().then(lista => setProductos(lista.filter(p => p.activo)));
    obtenerLotes().then(lista => setLotes(lista.filter(l => l.activo)));
    obtenerTaras().then(lista => setTaras(lista.filter(t => t.activo)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const pesoNetoTotal = useMemo(
    () => materiales.reduce((acc, f) => acc + netoFila(f, taras), 0),
    [materiales, taras]
  );
  const diferencia = useMemo(
    () => (ticket?.pesoGlobal ?? 0) - pesoNetoTotal - (Number(devolucionEdit) || 0),
    [ticket, pesoNetoTotal, devolucionEdit]
  );

  const iniciarEdicion = () => {
    if (!ticket) return;
    setMateriales(filasDesdeTicket(ticket));
    setDevolucionEdit(ticket.devolucion ? String(ticket.devolucion) : '');
    setFotosDevolucionEdit(ticket.fotosDevolucion.map(url => ({ tipo: 'existente' as const, url })));
    setObservacionesEdit(ticket.observaciones ?? '');
    setError(null);
    setEditando(true);
  };

  const cancelarEdicion = () => setEditando(false);

  const setFila = (uid: number, campo: keyof MaterialFila, valor: string) =>
    setMateriales(prev => prev.map(f => (f.uid === uid ? { ...f, [campo]: valor } : f)));

  const agregarMaterial = () => setMateriales(prev => [...prev, filaVacia()]);
  const quitarMaterial = (uid: number) =>
    setMateriales(prev => (prev.length > 1 ? prev.filter(f => f.uid !== uid) : prev));

  const agregarFotosFila = (uid: number, files: File[]) =>
    setMateriales(prev => prev.map(f => (f.uid === uid
      ? { ...f, fotos: [...f.fotos, ...files.map(file => ({ tipo: 'nueva' as const, file, preview: URL.createObjectURL(file) }))] }
      : f)));
  const quitarFotoFila = (uid: number, idx: number) =>
    setMateriales(prev => prev.map(f => (f.uid === uid ? { ...f, fotos: f.fotos.filter((_, i) => i !== idx) } : f)));

  const agregarFotosDevolucion = (files: File[]) =>
    setFotosDevolucionEdit(prev => [...prev, ...files.map(file => ({ tipo: 'nueva' as const, file, preview: URL.createObjectURL(file) }))]);
  const quitarFotoDevolucion = (idx: number) =>
    setFotosDevolucionEdit(prev => prev.filter((_, i) => i !== idx));

  const guardarEdicion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticket) return;
    setError(null);

    if (materiales.some(f => !f.productoId)) { setError('Cada material debe tener un producto seleccionado.'); return; }
    if (materiales.some(f => !esFilaSinLote(f, productos) && !f.destino)) { setError('Cada material debe tener un destino seleccionado.'); return; }
    if (materiales.some(f => f.taraModo === 'preconfigurada' && Number(f.taraCantidad) > 0 && !f.taraId)) {
      setError('Selecciona la tara preconfigurada para las unidades ingresadas.');
      return;
    }
    if (materiales.some(f => netoFila(f, taras) <= 0)) { setError('Cada material debe tener un peso neto mayor a 0.'); return; }

    setGuardando(true);

    const materialesConFotos = [];
    for (const f of materiales) {
      const urls = await subirFotosFila(f.fotos);
      if (!urls) {
        setError('No se pudo subir una de las fotos. Revisa que el bucket "tickets" exista en Supabase Storage.');
        setGuardando(false);
        return;
      }
      materialesConFotos.push({ ...materialAPayload(f, taras, productos), fotos: urls });
    }

    const urlsDevolucion = await subirFotosFila(fotosDevolucionEdit);
    if (!urlsDevolucion) {
      setError('No se pudo subir una de las fotos de la devolución. Revisa que el bucket "tickets" exista en Supabase Storage.');
      setGuardando(false);
      return;
    }

    const result = await editarTicket(ticket.id, {
      observaciones: observacionesEdit.trim() || null,
      devolucion: Number(devolucionEdit) || 0,
      fotosDevolucion: urlsDevolucion,
      materiales: materialesConFotos,
    });
    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    toast.exito(`${result.ticket.codigo} actualizado.`);
    setEditando(false);
    cargarTicket();
  };

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  if (cargando) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="text-center py-12">
        <p className="text-text-muted mb-4">No se encontró el ticket.</p>
        <button type="button" onClick={() => navigate('/pesaje')} className="text-brand-600 hover:underline text-sm">
          Volver a Pesaje
        </button>
      </div>
    );
  }

  const esCompra = ticket.tipo === 'compra';
  const puedeEditarEsteTicket = puedeEditar && !ticket.facturado;

  // Todas las fotos del ticket (por material + generales) en una sola galería
  // con etiqueta de material, en vez de un bloque apilado por material
  // (se veía como una lista infinita de fotos, una por fila).
  const fotosGaleria = [
    ...ticket.materiales.flatMap(m =>
      m.fotos.map((url, i) => ({ key: `m-${m.id}-${i}`, url, label: m.nombreProducto ?? 'Material' }))
    ),
    ...ticket.fotosDevolucion.map((url, i) => ({ key: `d-${i}`, url, label: 'Devolución' })),
    ...(ticket.fotos ?? []).map((url, i) => ({ key: `g-${i}`, url, label: 'General' })),
  ];

  return (
    <div className="max-w-2xl print-documento print:max-w-none">
      <div className="print:hidden">
        <button type="button" onClick={() => navigate('/pesaje')} className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors mb-4">
          <ArrowLeft size={16} />
          Pesaje
        </button>
      </div>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-text-primary">{ticket.codigo}</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs ${ticket.facturado ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'} print:border print:border-black print:bg-transparent`}>
              {ticket.facturado ? 'Facturado' : 'Pendiente por facturar'}
            </span>
            {ticket.pesajeExterior && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700 print:border print:border-black print:bg-transparent">
                Pesaje exterior
              </span>
            )}
          </div>
          <p className="text-sm text-text-muted mt-1">{esCompra ? 'Compra' : 'Venta'} · {ticket.fecha ?? ticket.createdAt.slice(0, 10)}</p>
        </div>
        {!editando && (
          <div className="print:hidden flex items-center gap-2 shrink-0">
            {puedeEditarEsteTicket && (
              <button type="button" onClick={iniciarEdicion} className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors" title="Editar ticket">
                <Pencil size={16} />
                Editar
              </button>
            )}
            <button type="button" onClick={() => window.print()} className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors" title="Imprimir">
              <Printer size={16} />
              Imprimir
            </button>
          </div>
        )}
      </div>

      {!editando ? (
        <div className="bg-surface rounded-xl border border-border p-5 mb-6 print:border-0 print:rounded-none print:shadow-none print:p-0 print:mb-4">
          <Fila label={esCompra ? 'Proveedor' : 'Cliente'} valor={ticket.entidadId ? (nombrePorEntidad.get(ticket.entidadId) ?? '—') : '—'} />

          {ticket.pesajeExterior ? (
            <p className="text-xs text-text-muted py-3 border-b border-border print:border-black">Pesaje exterior — sin peso global propio.</p>
          ) : (
            <div className="flex justify-between items-center py-3 border-b border-border print:border-black">
              <span className="font-semibold text-text-primary">Peso global</span>
              <span className="text-xl font-bold text-brand-700">{fmt(ticket.pesoGlobal)} kg</span>
            </div>
          )}
          {ticket.devolucion > 0 && (
            <div className="flex justify-between py-2 border-b border-border print:border-black text-sm">
              <span className="text-text-secondary">Devolución</span>
              <span className="text-text-primary font-medium">{fmt(ticket.devolucion)} kg</span>
            </div>
          )}

          {ticket.observaciones && <Fila label="Observaciones" valor={ticket.observaciones} />}

          <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer select-none w-fit mt-4 print:hidden">
            <input type="checkbox" checked={ocultarDestino} onChange={e => setOcultarDestino(e.target.checked)} className="rounded border-border" />
            Ocultar destino al imprimir (versión para el proveedor)
          </label>

          <div className="overflow-x-auto mt-2">
            <table className="w-full text-sm print:border-collapse">
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-muted print:border-black">
                  <th className="py-2 font-medium print:border print:border-black print:px-2">Material</th>
                  {!ocultarDestino && <th className="py-2 font-medium print:border print:border-black print:px-2">Destino</th>}
                  <th className="py-2 font-medium text-right print:border print:border-black print:px-2">Bruto</th>
                  <th className="py-2 font-medium text-right print:border print:border-black print:px-2">Tara</th>
                  <th className="py-2 font-medium text-right print:border print:border-black print:px-2">Devol.</th>
                  <th className="py-2 font-medium text-right print:border print:border-black print:px-2">Neto (kg)</th>
                </tr>
              </thead>
              <tbody>
                {ticket.materiales.map(m => (
                  <tr key={m.id} className="border-b border-border last:border-b-0 print:border-black">
                    <td className="py-2 text-text-primary print:border print:border-black print:px-2">{m.nombreProducto ?? '—'}</td>
                    {!ocultarDestino && <td className="py-2 text-text-secondary print:border print:border-black print:px-2">{destinoLabel(m.destinoTipo, m.nombreLote)}</td>}
                    <td className="py-2 text-right text-text-secondary print:border print:border-black print:px-2">{fmt(m.pesoBruto)}</td>
                    <td className="py-2 text-right text-text-secondary print:border print:border-black print:px-2">{fmt(m.tara)}</td>
                    <td className="py-2 text-right text-text-secondary print:border print:border-black print:px-2">{fmt(m.devolucion)}</td>
                    <td className="py-2 text-right font-medium text-text-primary print:border print:border-black print:px-2">{fmt(m.pesoNeto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {fotosGaleria.length > 0 && (
            <div className="mt-4 print:hidden">
              <p className="text-xs font-medium text-text-secondary mb-2">Fotos ({fotosGaleria.length})</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {fotosGaleria.map(({ key, url, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFotoAmpliada(url)}
                    className="group relative aspect-square rounded-lg overflow-hidden border border-border"
                    title="Ver foto en grande"
                  >
                    <img src={url} alt={label} loading="lazy" className="w-full h-full object-cover" />
                    <span className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] leading-tight px-1.5 py-1 truncate text-left">
                      {label}
                    </span>
                    <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
                      <ZoomIn size={16} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={guardarEdicion} className="bg-surface rounded-xl border border-border p-5 space-y-4">
          {ticket.pesajeExterior ? (
            <p className="text-xs text-text-muted bg-surface-alt border border-border rounded-lg px-4 py-2.5">
              Pesaje exterior — sin peso global propio para reconciliar.
            </p>
          ) : (
            <div className="flex items-center justify-between text-sm bg-surface-alt border border-border rounded-lg px-4 py-2.5">
              <span className="text-text-secondary">Peso global (fijado al crear el ticket)</span>
              <span className="font-semibold text-text-primary">{fmt(ticket.pesoGlobal)} kg</span>
            </div>
          )}

          <div className="space-y-3">
            <label className={labelClass + ' mb-0'}>Materiales</label>

            {materiales.map((f, idx) => {
              const neto = netoFila(f, taras);
              return (
                <div key={f.uid} className="border border-border rounded-lg p-3 space-y-3 bg-surface-alt/40">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-text-secondary">Material {idx + 1}</span>
                    {materiales.length > 1 && (
                      <button type="button" onClick={() => quitarMaterial(f.uid)} className="text-text-muted hover:text-red-600 transition-colors" title="Quitar material">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>

                  <div>
                    <label className={labelClass}>Material *</label>
                    <select value={f.productoId} onChange={e => setFila(f.uid, 'productoId', e.target.value)} className={inputClass}>
                      <option value="">— Selecciona —</option>
                      {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                  </div>

                  {esFilaSinLote(f, productos) ? (
                    <p className="text-xs text-text-muted bg-surface-alt border border-border rounded-lg px-3 py-2">
                      "{productos.find(p => p.id === f.productoId)?.tipoMaterialNombre}" es una categoría sin lote — este material va directo a inventario general, no pide lote.
                    </p>
                  ) : (
                    <div>
                      <label className={labelClass}>Destino (inventario) *</label>
                      <select required value={f.destino} onChange={e => setFila(f.uid, 'destino', e.target.value)} className={inputClass}>
                        <option value="" disabled>-Selecciona-</option>
                        {lotes.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                      </select>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Peso bruto (kg)</label>
                      <input type="number" step="0.001" min="0" value={f.pesoBruto} onChange={e => setFila(f.uid, 'pesoBruto', e.target.value)} className={inputClass} placeholder="0.00" />
                    </div>
                    <div>
                      <label className={labelClass}>Tara</label>
                      <div className="flex rounded-md overflow-hidden border border-border text-[11px] w-fit mb-1.5">
                        <button type="button" onClick={() => setFila(f.uid, 'taraModo', 'preconfigurada')} className={`px-2 py-1 ${f.taraModo === 'preconfigurada' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
                          Preconfigurada
                        </button>
                        <button type="button" onClick={() => setFila(f.uid, 'taraModo', 'manual')} className={`px-2 py-1 ${f.taraModo === 'manual' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
                          Manual
                        </button>
                      </div>
                      {f.taraModo === 'preconfigurada' ? (
                        <div>
                          <div className="grid grid-cols-2 gap-2">
                            <select value={f.taraId} onChange={e => setFila(f.uid, 'taraId', e.target.value)} className={inputClass}>
                              <option value="">— Tara —</option>
                              {taras.map(t => <option key={t.id} value={t.id}>{t.nombre} ({t.peso} kg)</option>)}
                            </select>
                            <input type="number" step="1" min="0" value={f.taraCantidad} onChange={e => setFila(f.uid, 'taraCantidad', e.target.value)} className={inputClass} placeholder="Cantidad" />
                          </div>
                          <p className="text-[11px] text-text-muted mt-1">= {fmt(taraKgFila(f, taras))} kg</p>
                        </div>
                      ) : (
                        <input type="number" step="0.001" min="0" value={f.taraManual} onChange={e => setFila(f.uid, 'taraManual', e.target.value)} className={inputClass} placeholder="0.00" />
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 text-sm">
                    <span className="text-text-muted">Neto del material</span>
                    <span className={`font-semibold ${neto < 0 ? 'text-red-600' : 'text-text-primary'}`}>{fmt(neto)} kg</span>
                  </div>

                  <FotoMaterialPicker
                    fotos={f.fotos}
                    onAgregar={files => agregarFotosFila(f.uid, files)}
                    onQuitar={idx => quitarFotoFila(f.uid, idx)}
                  />
                </div>
              );
            })}

            <button type="button" onClick={agregarMaterial} className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors">
              <Plus size={16} />
              Agregar material
            </button>
          </div>

          <div className="bg-brand-50 border border-brand-200 rounded-lg px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium text-brand-800">
                <Scale size={16} />
                Suma de materiales
              </span>
              <span className={`text-lg font-bold ${pesoNetoTotal < 0 ? 'text-red-600' : 'text-brand-700'}`}>{fmt(pesoNetoTotal)} kg</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm border-t border-brand-200 pt-2">
              <label htmlFor="devolucion-edit" className="text-brand-800 shrink-0">Devolución (kg)</label>
              <input
                id="devolucion-edit"
                type="number"
                step="0.001"
                min="0"
                value={devolucionEdit}
                onChange={e => setDevolucionEdit(e.target.value)}
                className="w-28 px-2 py-1 bg-surface border border-brand-200 rounded-md text-sm text-right focus:outline-none focus:ring-2 focus:ring-brand-400"
                placeholder="0.00"
              />
            </div>
            <FotoMaterialPicker
              label="Fotos de la devolución"
              fotos={fotosDevolucionEdit}
              onAgregar={agregarFotosDevolucion}
              onQuitar={quitarFotoDevolucion}
            />
            {!ticket.pesajeExterior && (
              <div className="flex items-center justify-between text-sm border-t border-brand-200 pt-2">
                <span className="text-brand-800">Diferencia (global vs. neto + devolución)</span>
                <span className={`font-semibold ${Math.abs(diferencia) > 0.01 ? 'text-amber-600' : 'text-brand-700'}`}>{fmt(diferencia)} kg</span>
              </div>
            )}
          </div>

          <div>
            <label className={labelClass}>Observaciones</label>
            <textarea value={observacionesEdit} onChange={e => setObservacionesEdit(e.target.value)} className={`${inputClass} resize-none`} rows={2} placeholder="Notas del pesaje" />
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={cancelarEdicion} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? <><Loader2 size={16} className="animate-spin" /> Guardando...</> : 'Guardar cambios'}
            </button>
          </div>
        </form>
      )}

      {fotoAmpliada && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4 print:hidden"
          onClick={() => setFotoAmpliada(null)}
        >
          <button
            type="button"
            onClick={() => setFotoAmpliada(null)}
            className="absolute top-4 right-4 text-white/80 hover:text-white"
            title="Cerrar"
          >
            <X size={24} />
          </button>
          <img
            src={fotoAmpliada}
            alt="Foto ampliada"
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

function Fila({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex justify-between py-2 border-b border-border last:border-b-0 print:border-black">
      <span className="text-text-secondary text-sm">{label}</span>
      <span className="text-text-primary text-sm font-medium text-right">{valor}</span>
    </div>
  );
}

export default TicketDetallePage;
