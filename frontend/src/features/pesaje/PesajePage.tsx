import { useEffect, useMemo, useRef, useState } from 'react';
import { Scale, ImagePlus, X, Loader2, Plus, Trash2 } from 'lucide-react';
import { obtenerProveedores } from '../../services/proveedor-service';
import { obtenerClientes } from '../../services/cliente-service';
import { obtenerProductos } from '../../services/producto-service';
import { obtenerTickets, crearTicket } from '../../services/ticket-pesaje-service';
import { obtenerLotes } from '../../services/lote-service';
import { subirFotoTicket } from '../../services/storage-service';
import { useAuth } from '../../hooks/use-auth';
import { useToast } from '../../hooks/use-toast';
import type { Producto, TicketPesaje, Lote } from '@shared/types/index.js';

interface FotoLocal { file: File; preview: string }
interface Entidad { id: string; nombre: string; activo: boolean }
type TipoPesaje = 'compra' | 'venta';

/** Valor del selector de destino: 'mpp' o el id de un lote. */
type DestinoValor = 'mpp' | string;

/** Una fila de material en el formulario (valores como string para los inputs). */
interface MaterialFila {
  /** id local para la key de React. */
  uid: number;
  productoId: string;
  subcategoria: string;
  pesoBruto: string;
  tara: string;
  devolucion: string;
  /** 'mpp' o el id del lote destino. */
  destino: DestinoValor;
}

let UID = 0;
function filaVacia(): MaterialFila {
  return { uid: UID++, productoId: '', subcategoria: '', pesoBruto: '', tara: '', devolucion: '', destino: 'mpp' };
}

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function netoFila(f: MaterialFila): number {
  return (Number(f.pesoBruto) || 0) - (Number(f.tara) || 0) - (Number(f.devolucion) || 0);
}

type Pestana = 'nuevo' | 'tickets';

function PesajePage() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const puedeCrear = tienePermiso('pesaje', 'crear');
  const puedeVerTickets = tienePermiso('pesaje', 'ver') && tienePermiso('facturacion', 'ver');

  const [pestana, setPestana] = useState<Pestana>('nuevo');
  const [proveedores, setProveedores] = useState<Entidad[]>([]);
  const [clientes, setClientes] = useState<Entidad[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [tickets, setTickets] = useState<TicketPesaje[]>([]);

  const [tipo, setTipo] = useState<TipoPesaje>('compra');
  const [entidadId, setEntidadId] = useState('');
  const [fecha, setFecha] = useState(hoyISO());
  const [materiales, setMateriales] = useState<MaterialFila[]>([filaVacia()]);
  const [observaciones, setObservaciones] = useState('');
  const [fotos, setFotos] = useState<FotoLocal[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargarTickets = () => { obtenerTickets().then(setTickets); };

  useEffect(() => {
    obtenerProveedores().then(lista => setProveedores(lista.filter(p => p.activo)));
    obtenerClientes().then(lista => setClientes(lista.filter(c => c.activo)));
    obtenerProductos().then(lista => setProductos(lista.filter(p => p.activo)));
    obtenerLotes().then(lista => setLotes(lista.filter(l => l.activo)));
    cargarTickets();
  }, []);

  const entidades = tipo === 'compra' ? proveedores : clientes;
  const labelEntidad = tipo === 'compra' ? 'Proveedor' : 'Cliente';

  // Mapa id→nombre de proveedores + clientes (para la tabla de tickets recientes)
  const nombrePorEntidad = useMemo(() => {
    const m = new Map<string, string>();
    [...proveedores, ...clientes].forEach(e => m.set(e.id, e.nombre));
    return m;
  }, [proveedores, clientes]);

  const pesoNetoTotal = useMemo(
    () => materiales.reduce((acc, f) => acc + netoFila(f), 0),
    [materiales]
  );

  const setFila = (uid: number, campo: keyof MaterialFila, valor: string) =>
    setMateriales(prev => prev.map(f => (f.uid === uid ? { ...f, [campo]: valor } : f)));

  const agregarMaterial = () => setMateriales(prev => [...prev, filaVacia()]);
  const quitarMaterial = (uid: number) =>
    setMateriales(prev => (prev.length > 1 ? prev.filter(f => f.uid !== uid) : prev));

  const handleFotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setFotos(prev => [...prev, ...files.map(file => ({ file, preview: URL.createObjectURL(file) }))]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const quitarFoto = (idx: number) => setFotos(prev => prev.filter((_, i) => i !== idx));

  const limpiar = () => {
    setEntidadId('');
    setFecha(hoyISO());
    setMateriales([filaVacia()]);
    setObservaciones('');
    setFotos([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!entidadId) { setError(`Elige un ${labelEntidad.toLowerCase()}.`); return; }
    if (materiales.some(f => !f.productoId)) { setError('Cada material debe tener un producto seleccionado.'); return; }
    if (materiales.some(f => netoFila(f) < 0)) { setError('El peso neto de un material no puede ser negativo. Revisa bruto, tara y devolución.'); return; }
    if (materiales.some(f => netoFila(f) <= 0)) { setError('Cada material debe tener un peso neto mayor a 0.'); return; }

    setGuardando(true);

    const urls: string[] = [];
    for (const f of fotos) {
      const url = await subirFotoTicket(f.file);
      if (!url) {
        setError('No se pudo subir una de las fotos. Revisa que el bucket "tickets" exista en Supabase Storage.');
        setGuardando(false);
        return;
      }
      urls.push(url);
    }

    const result = await crearTicket({
      tipo,
      entidadId,
      fecha,
      materiales: materiales.map(f => ({
        productoId: f.productoId,
        subcategoria: f.subcategoria.trim() || null,
        pesoBruto: Number(f.pesoBruto) || 0,
        tara: Number(f.tara) || 0,
        devolucion: Number(f.devolucion) || 0,
        destinoTipo: f.destino === 'mpp' ? ('mpp' as const) : ('lote' as const),
        loteId: f.destino === 'mpp' ? null : f.destino,
      })),
      fotos: urls,
      observaciones: observaciones.trim() || null,
    });

    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    toast.exito(`${result.ticket.codigo} generado (neto ${fmt(result.ticket.pesoNetoTotal)} kg).`);
    limpiar();
    cargarTickets();
  };

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";
  const fmt = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Pesaje</h1>
        <p className="text-sm text-text-secondary mt-1">
          Registra la pesada del material antes de facturar. Genera un ticket que luego se adjunta a la factura.
        </p>
      </div>

      {puedeVerTickets && (
        <div className="flex rounded-lg overflow-hidden border border-border text-sm w-fit mb-6">
          <button type="button" onClick={() => setPestana('nuevo')} className={`px-4 py-1.5 ${pestana === 'nuevo' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
            Nuevo pesaje
          </button>
          <button type="button" onClick={() => setPestana('tickets')} className={`px-4 py-1.5 ${pestana === 'tickets' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
            Tickets
          </button>
        </div>
      )}

      {pestana === 'nuevo' && (
      <div className={puedeVerTickets ? 'max-w-2xl' : 'grid grid-cols-1 lg:grid-cols-2 gap-6'}>
        {puedeCrear ? (
          <form onSubmit={handleSubmit} className="bg-surface rounded-xl border border-border p-5 space-y-4 h-fit">
            {/* Toggle compra/venta */}
            <div>
              <label className={labelClass}>Tipo de operación</label>
              <div className="flex rounded-lg overflow-hidden border border-border text-sm w-fit">
                <button type="button" onClick={() => { setTipo('compra'); setEntidadId(''); }} className={`px-4 py-1.5 ${tipo === 'compra' ? 'bg-brand-600 text-white' : 'bg-surface-alt text-text-secondary'}`}>
                  Compra (proveedor)
                </button>
                <button type="button" onClick={() => { setTipo('venta'); setEntidadId(''); }} className={`px-4 py-1.5 ${tipo === 'venta' ? 'bg-brand-600 text-white' : 'bg-surface-alt text-text-secondary'}`}>
                  Venta (cliente)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>{labelEntidad} *</label>
                <select value={entidadId} onChange={e => setEntidadId(e.target.value)} className={inputClass}>
                  <option value="">— Selecciona —</option>
                  {entidades.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Fecha</label>
                <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className={inputClass} />
              </div>
            </div>

            {/* Materiales */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className={labelClass + ' mb-0'}>Materiales</label>
                <button type="button" onClick={agregarMaterial} className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors">
                  <Plus size={16} />
                  Agregar material
                </button>
              </div>

              {materiales.map((f, idx) => {
                const neto = netoFila(f);
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

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelClass}>Material *</label>
                        <select value={f.productoId} onChange={e => setFila(f.uid, 'productoId', e.target.value)} className={inputClass}>
                          <option value="">— Selecciona —</option>
                          {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={labelClass}>Subcategoría / detalle</label>
                        <input type="text" value={f.subcategoria} onChange={e => setFila(f.uid, 'subcategoria', e.target.value)} className={inputClass} placeholder="Ej. PCB media densidad" />
                      </div>
                    </div>

                    <div>
                      <label className={labelClass}>Destino (inventario) *</label>
                      <select value={f.destino} onChange={e => setFila(f.uid, 'destino', e.target.value)} className={inputClass}>
                        <option value="mpp">MPP (Material Por Procesar)</option>
                        {lotes.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                      </select>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className={labelClass}>Peso bruto (kg)</label>
                        <input type="number" step="0.01" min="0" value={f.pesoBruto} onChange={e => setFila(f.uid, 'pesoBruto', e.target.value)} className={inputClass} placeholder="0.00" />
                      </div>
                      <div>
                        <label className={labelClass}>Tara (kg)</label>
                        <input type="number" step="0.01" min="0" value={f.tara} onChange={e => setFila(f.uid, 'tara', e.target.value)} className={inputClass} placeholder="0.00" />
                      </div>
                      <div>
                        <label className={labelClass}>Devolución (kg)</label>
                        <input type="number" step="0.01" min="0" value={f.devolucion} onChange={e => setFila(f.uid, 'devolucion', e.target.value)} className={inputClass} placeholder="0.00" />
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-sm">
                      <span className="text-text-muted">Neto del material</span>
                      <span className={`font-semibold ${neto < 0 ? 'text-red-600' : 'text-text-primary'}`}>{fmt(neto)} kg</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between bg-brand-50 border border-brand-200 rounded-lg px-4 py-3">
              <span className="flex items-center gap-2 text-sm font-medium text-brand-800">
                <Scale size={16} />
                Peso neto total
              </span>
              <span className={`text-lg font-bold ${pesoNetoTotal < 0 ? 'text-red-600' : 'text-brand-700'}`}>
                {fmt(pesoNetoTotal)} kg
              </span>
            </div>

            <div>
              <label className={labelClass}>Fotos de evidencia</label>
              <div className="flex flex-wrap gap-2">
                {fotos.map((f, idx) => (
                  <div key={idx} className="relative w-20 h-20 rounded-lg overflow-hidden border border-border">
                    <img src={f.preview} alt={`Foto ${idx + 1}`} className="w-full h-full object-cover" />
                    <button type="button" onClick={() => quitarFoto(idx)} className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5 hover:bg-black/80">
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => fileInputRef.current?.click()} className="w-20 h-20 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center text-text-muted hover:border-brand-400 hover:text-brand-600 transition-colors">
                  <ImagePlus size={20} />
                  <span className="text-[10px] mt-1">Agregar</span>
                </button>
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFotos} className="hidden" />
            </div>

            <div>
              <label className={labelClass}>Observaciones</label>
              <textarea value={observaciones} onChange={e => setObservaciones(e.target.value)} className={`${inputClass} resize-none`} rows={2} placeholder="Notas del pesaje" />
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}

            <button type="submit" disabled={guardando} className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? <><Loader2 size={16} className="animate-spin" /> Guardando...</> : 'Generar ticket de pesaje'}
            </button>

            <p className="text-xs text-text-muted">
              ¿La operación fue fuera de la empresa y no se pesó aquí? Entonces no se genera ticket: el peso se ingresa a mano al crear la factura.
            </p>
          </form>
        ) : (
          <p className="text-text-muted text-sm">No tienes permiso para registrar pesajes.</p>
        )}

        {!puedeVerTickets && (
          <div>
            <h2 className="text-sm font-semibold text-text-secondary mb-3">Tickets recientes</h2>
            <TablaTickets tickets={tickets} nombrePorEntidad={nombrePorEntidad} fmt={fmt} />
          </div>
        )}
      </div>
      )}

      {pestana === 'tickets' && puedeVerTickets && (
        <div>
          <h2 className="text-sm font-semibold text-text-secondary mb-3">Tickets de pesaje</h2>
          <TablaTickets tickets={tickets} nombrePorEntidad={nombrePorEntidad} fmt={fmt} />
        </div>
      )}
    </div>
  );
}

function TablaTickets({
  tickets,
  nombrePorEntidad,
  fmt,
}: {
  tickets: TicketPesaje[];
  nombrePorEntidad: Map<string, string>;
  fmt: (n: number) => string;
}) {
  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden">
      {tickets.length === 0 ? (
        <p className="text-center text-text-muted py-10 text-sm">Aún no hay tickets de pesaje.</p>
      ) : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-text-muted">
              <th className="px-4 py-2.5 font-medium">N° Control</th>
              <th className="px-4 py-2.5 font-medium">Fecha</th>
              <th className="px-4 py-2.5 font-medium">Tipo</th>
              <th className="px-4 py-2.5 font-medium">Entidad</th>
              <th className="px-4 py-2.5 font-medium">Materiales</th>
              <th className="px-4 py-2.5 font-medium text-right">Neto (kg)</th>
              <th className="px-4 py-2.5 font-medium text-right">Estado</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map(t => (
              <tr key={t.id} className="border-b border-border last:border-b-0">
                <td className="px-4 py-2.5 font-medium text-text-primary whitespace-nowrap">{t.codigo}</td>
                <td className="px-4 py-2.5 text-text-secondary whitespace-nowrap">{t.fecha ?? '—'}</td>
                <td className="px-4 py-2.5 text-text-secondary capitalize">{t.tipo}</td>
                <td className="px-4 py-2.5 text-text-primary">{t.entidadId ? (nombrePorEntidad.get(t.entidadId) ?? '—') : '—'}</td>
                <td className="px-4 py-2.5 text-text-secondary">{resumenMateriales(t)}</td>
                <td className="px-4 py-2.5 text-right font-medium text-text-primary">{fmt(t.pesoNetoTotal)}</td>
                <td className="px-4 py-2.5 text-right">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${t.facturado ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                    {t.facturado ? 'Facturado' : 'Pendiente'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}

/** Resumen de los materiales de un ticket: nombre si es uno, "N materiales" si varios. */
function resumenMateriales(t: TicketPesaje): string {
  if (t.materiales.length === 0) return '—';
  if (t.materiales.length === 1) return t.materiales[0].nombreProducto ?? 'material';
  return `${t.materiales.length} materiales`;
}

export default PesajePage;
