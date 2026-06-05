import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { obtenerProveedores } from '../../services/proveedor-service';
import { obtenerClientes } from '../../services/cliente-service';
import { obtenerProductos } from '../../services/producto-service';
import { obtenerTickets } from '../../services/ticket-pesaje-service';
import { crearFactura, type TipoFactura } from '../../services/factura-cv-service';
import ListaPreciosSelector from '../../components/ListaPreciosSelector';
import { useToast } from '../../hooks/use-toast';
import type { Producto, TicketPesaje } from '@shared/types/index.js';

interface Entidad { id: string; nombre: string; activo: boolean }
type ModoPeso = 'ticket' | 'manual';

interface Props {
  tipo: TipoFactura;
}

function FacturaFormPage({ tipo }: Props) {
  const navigate = useNavigate();
  const toast = useToast();

  const esCompra = tipo === 'compra';
  const labelEntidad = esCompra ? 'Proveedor' : 'Cliente';
  const ruta = esCompra ? '/compras' : '/ventas';
  const titulo = esCompra ? 'Nueva factura de compra' : 'Nueva factura de venta';

  const [entidades, setEntidades] = useState<Entidad[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [ticketsPendientes, setTicketsPendientes] = useState<TicketPesaje[]>([]);

  const [entidadId, setEntidadId] = useState('');
  const [productoId, setProductoId] = useState('');
  const [modoPeso, setModoPeso] = useState<ModoPeso>('ticket');
  const [ticketId, setTicketId] = useState('');
  const [pesoManual, setPesoManual] = useState('');
  const [listaPreciosId, setListaPreciosId] = useState<string | null>(null);
  const [precioUnitario, setPrecioUnitario] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [observaciones, setObservaciones] = useState('');

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cargar = (): Promise<Entidad[]> => (esCompra ? obtenerProveedores() : obtenerClientes());
    cargar().then(lista => setEntidades(lista.filter(e => e.activo)));
    obtenerProductos().then(lista => setProductos(lista.filter(p => p.activo)));
  }, [esCompra]);

  useEffect(() => {
    if (!entidadId) { setTicketsPendientes([]); return; }
    obtenerTickets({ soloNoFacturados: true, entidadId, tipo }).then(setTicketsPendientes);
  }, [entidadId, tipo]);

  const ticketSel = useMemo(
    () => ticketsPendientes.find(t => t.id === ticketId) ?? null,
    [ticketsPendientes, ticketId]
  );

  useEffect(() => {
    if (ticketSel?.productoId) setProductoId(ticketSel.productoId);
  }, [ticketSel]);

  const peso = modoPeso === 'ticket' ? (ticketSel?.pesoNeto ?? 0) : Number(pesoManual) || 0;
  const total = peso * (Number(precioUnitario) || 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!entidadId) { setError(`Elige un ${labelEntidad.toLowerCase()}.`); return; }
    if (!productoId) { setError('Elige el material.'); return; }
    if (modoPeso === 'ticket' && !ticketId) { setError('Selecciona un ticket de pesaje o cambia a peso manual.'); return; }
    if (modoPeso === 'manual' && peso <= 0) { setError('Ingresa un peso manual mayor a 0.'); return; }
    if (Number(precioUnitario) <= 0) { setError('Ingresa un precio unitario mayor a 0.'); return; }

    setGuardando(true);
    const result = await crearFactura(tipo, {
      entidadId,
      productoId,
      ticketId: modoPeso === 'ticket' ? ticketId : null,
      pesoManual: modoPeso === 'manual' ? peso : null,
      listaPreciosId,
      precioUnitario: Number(precioUnitario),
      descripcion: descripcion.trim() || null,
      observaciones: observaciones.trim() || null,
    });
    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    toast.exito(esCompra ? 'Factura de compra emitida.' : 'Factura de venta emitida.');
    navigate(`${ruta}/${result.factura.id}`);
  };

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";
  const fmt = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="max-w-2xl">
      <button type="button" onClick={() => navigate(ruta)} className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors mb-4">
        <ArrowLeft size={16} />
        {esCompra ? 'Compras' : 'Ventas'}
      </button>

      <h1 className="text-2xl font-bold text-text-primary mb-6">{titulo}</h1>

      <form onSubmit={handleSubmit} className="bg-surface rounded-xl border border-border p-5 space-y-4">
        <div>
          <label className={labelClass}>{labelEntidad} *</label>
          <select value={entidadId} onChange={e => { setEntidadId(e.target.value); setTicketId(''); }} className={inputClass}>
            <option value="">— Selecciona —</option>
            {entidades.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </div>

        <div>
          <label className={labelClass}>Origen del peso</label>
          <div className="flex rounded-lg overflow-hidden border border-border text-sm w-fit mb-3">
            <button type="button" onClick={() => setModoPeso('ticket')} className={`px-4 py-1.5 ${modoPeso === 'ticket' ? 'bg-brand-600 text-white' : 'bg-surface-alt text-text-secondary'}`}>
              Ticket de pesaje
            </button>
            <button type="button" onClick={() => setModoPeso('manual')} className={`px-4 py-1.5 ${modoPeso === 'manual' ? 'bg-brand-600 text-white' : 'bg-surface-alt text-text-secondary'}`}>
              Peso manual
            </button>
          </div>

          {modoPeso === 'ticket' ? (
            <select value={ticketId} onChange={e => setTicketId(e.target.value)} className={inputClass} disabled={!entidadId}>
              <option value="">
                {!entidadId ? `Elige primero un ${labelEntidad.toLowerCase()}` : ticketsPendientes.length === 0 ? `Sin tickets pendientes para este ${labelEntidad.toLowerCase()}` : '— Selecciona un ticket —'}
              </option>
              {ticketsPendientes.map(t => (
                <option key={t.id} value={t.id}>
                  {t.fecha ?? '—'} · {t.nombreProducto ?? 'material'} · {(t.pesoNeto ?? 0)} kg
                </option>
              ))}
            </select>
          ) : (
            <input type="number" step="0.01" min="0" value={pesoManual} onChange={e => setPesoManual(e.target.value)} className={inputClass} placeholder="Peso en kg" />
          )}
        </div>

        <div>
          <label className={labelClass}>Material *</label>
          <select value={productoId} onChange={e => setProductoId(e.target.value)} className={inputClass} disabled={modoPeso === 'ticket' && !!ticketSel}>
            <option value="">— Selecciona —</option>
            {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          {modoPeso === 'ticket' && ticketSel && (
            <p className="text-xs text-text-muted mt-1">El material lo define el ticket seleccionado.</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Lista de precios</label>
            <ListaPreciosSelector
              productoId={productoId}
              value={listaPreciosId}
              onChange={(listaId, precio) => {
                setListaPreciosId(listaId);
                if (precio != null) setPrecioUnitario(String(precio));
              }}
            />
          </div>
          <div>
            <label className={labelClass}>Precio unitario (por kg) *</label>
            <input type="number" step="0.01" min="0" value={precioUnitario} onChange={e => setPrecioUnitario(e.target.value)} className={inputClass} placeholder="0.00" />
          </div>
        </div>

        <div>
          <label className={labelClass}>Descripción</label>
          <input type="text" value={descripcion} onChange={e => setDescripcion(e.target.value)} className={inputClass} placeholder="Opcional" />
        </div>
        <div>
          <label className={labelClass}>Observaciones</label>
          <textarea value={observaciones} onChange={e => setObservaciones(e.target.value)} className={`${inputClass} resize-none`} rows={2} placeholder="Opcional" />
        </div>

        <div className="flex items-center justify-between bg-brand-50 border border-brand-200 rounded-lg px-4 py-3">
          <div className="text-sm text-brand-800">
            <span className="font-medium">{fmt(peso)} kg</span> × <span className="font-medium">{fmt(Number(precioUnitario) || 0)}</span>
          </div>
          <div className="text-right">
            <p className="text-xs text-brand-700">Total</p>
            <p className="text-xl font-bold text-brand-700">{fmt(total)}</p>
          </div>
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => navigate(ruta)} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
            Cancelar
          </button>
          <button type="submit" disabled={guardando} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
            {guardando ? <><Loader2 size={16} className="animate-spin" /> Emitiendo...</> : 'Emitir factura'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default FacturaFormPage;
