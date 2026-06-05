import { useEffect, useMemo, useRef, useState } from 'react';
import { Scale, ImagePlus, X, Loader2 } from 'lucide-react';
import { obtenerProveedores } from '../../services/proveedor-service';
import { obtenerClientes } from '../../services/cliente-service';
import { obtenerProductos } from '../../services/producto-service';
import { obtenerTickets, crearTicket } from '../../services/ticket-pesaje-service';
import { subirFotoTicket } from '../../services/storage-service';
import { useAuth } from '../../hooks/use-auth';
import { useToast } from '../../hooks/use-toast';
import type { Producto, TicketPesaje } from '@shared/types/index.js';

interface FotoLocal { file: File; preview: string }
interface Entidad { id: string; nombre: string; activo: boolean }
type TipoPesaje = 'compra' | 'venta';

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function PesajePage() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const puedeCrear = tienePermiso('pesaje', 'crear');

  const [proveedores, setProveedores] = useState<Entidad[]>([]);
  const [clientes, setClientes] = useState<Entidad[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [tickets, setTickets] = useState<TicketPesaje[]>([]);

  const [tipo, setTipo] = useState<TipoPesaje>('compra');
  const [entidadId, setEntidadId] = useState('');
  const [productoId, setProductoId] = useState('');
  const [fecha, setFecha] = useState(hoyISO());
  const [subcategoria, setSubcategoria] = useState('');
  const [pesoBruto, setPesoBruto] = useState('');
  const [tara, setTara] = useState('');
  const [devolucion, setDevolucion] = useState('');
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

  const bruto = Number(pesoBruto) || 0;
  const taraN = Number(tara) || 0;
  const devN = Number(devolucion) || 0;
  const pesoNeto = bruto - taraN - devN;

  const handleFotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setFotos(prev => [...prev, ...files.map(file => ({ file, preview: URL.createObjectURL(file) }))]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const quitarFoto = (idx: number) => setFotos(prev => prev.filter((_, i) => i !== idx));

  const limpiar = () => {
    setEntidadId('');
    setProductoId('');
    setFecha(hoyISO());
    setSubcategoria('');
    setPesoBruto('');
    setTara('');
    setDevolucion('');
    setObservaciones('');
    setFotos([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!entidadId) { setError(`Elige un ${labelEntidad.toLowerCase()}.`); return; }
    if (!productoId) { setError('Elige el material a pesar.'); return; }
    if (pesoNeto < 0) { setError('El peso neto no puede ser negativo. Revisa bruto, tara y devolución.'); return; }

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
      productoId,
      fecha,
      subcategoria: subcategoria.trim() || null,
      pesoBruto: bruto,
      tara: taraN,
      devolucion: devN,
      fotos: urls,
      observaciones: observaciones.trim() || null,
    });

    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    toast.exito(`Ticket de pesaje generado (neto ${result.ticket.pesoNeto} kg).`);
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                <label className={labelClass}>Material *</label>
                <select value={productoId} onChange={e => setProductoId(e.target.value)} className={inputClass}>
                  <option value="">— Selecciona —</option>
                  {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Fecha</label>
                <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Subcategoría / detalle</label>
                <input type="text" value={subcategoria} onChange={e => setSubcategoria(e.target.value)} className={inputClass} placeholder="Ej. PCB media densidad" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>Peso bruto (kg)</label>
                <input type="number" step="0.01" min="0" value={pesoBruto} onChange={e => setPesoBruto(e.target.value)} className={inputClass} placeholder="0.00" />
              </div>
              <div>
                <label className={labelClass}>Tara (kg)</label>
                <input type="number" step="0.01" min="0" value={tara} onChange={e => setTara(e.target.value)} className={inputClass} placeholder="0.00" />
              </div>
              <div>
                <label className={labelClass}>Devolución (kg)</label>
                <input type="number" step="0.01" min="0" value={devolucion} onChange={e => setDevolucion(e.target.value)} className={inputClass} placeholder="0.00" />
              </div>
            </div>

            <div className="flex items-center justify-between bg-brand-50 border border-brand-200 rounded-lg px-4 py-3">
              <span className="flex items-center gap-2 text-sm font-medium text-brand-800">
                <Scale size={16} />
                Peso neto
              </span>
              <span className={`text-lg font-bold ${pesoNeto < 0 ? 'text-red-600' : 'text-brand-700'}`}>
                {fmt(pesoNeto)} kg
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

        <div>
          <h2 className="text-sm font-semibold text-text-secondary mb-3">Tickets recientes</h2>
          <div className="bg-surface rounded-xl border border-border overflow-hidden">
            {tickets.length === 0 ? (
              <p className="text-center text-text-muted py-10 text-sm">Aún no hay tickets de pesaje.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-text-muted">
                    <th className="px-4 py-2.5 font-medium">Fecha</th>
                    <th className="px-4 py-2.5 font-medium">Tipo</th>
                    <th className="px-4 py-2.5 font-medium">Entidad</th>
                    <th className="px-4 py-2.5 font-medium">Material</th>
                    <th className="px-4 py-2.5 font-medium text-right">Neto (kg)</th>
                    <th className="px-4 py-2.5 font-medium text-right">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map(t => (
                    <tr key={t.id} className="border-b border-border last:border-b-0">
                      <td className="px-4 py-2.5 text-text-secondary whitespace-nowrap">{t.fecha ?? '—'}</td>
                      <td className="px-4 py-2.5 text-text-secondary capitalize">{t.tipo}</td>
                      <td className="px-4 py-2.5 text-text-primary">{t.entidadId ? (nombrePorEntidad.get(t.entidadId) ?? '—') : '—'}</td>
                      <td className="px-4 py-2.5 text-text-secondary">{t.nombreProducto ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-text-primary">{fmt(t.pesoNeto ?? 0)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${t.facturado ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                          {t.facturado ? 'Facturado' : 'Pendiente'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default PesajePage;
