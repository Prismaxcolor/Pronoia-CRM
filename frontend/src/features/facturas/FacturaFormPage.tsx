import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronDown, Loader2, Plus, Trash2 } from 'lucide-react';
import { obtenerProveedores } from '../../services/proveedor-service';
import { obtenerClientes } from '../../services/cliente-service';
import { obtenerProductos } from '../../services/producto-service';
import { obtenerTickets, crearTicket } from '../../services/ticket-pesaje-service';
import { obtenerLotes } from '../../services/lote-service';
import { crearFactura, type TipoFactura } from '../../services/factura-cv-service';
import { obtenerListas, obtenerListaDetalle } from '../../services/lista-precios-service';
import { useToast } from '../../hooks/use-toast-context';
import SeleccionarEntidadModal from '../../components/SeleccionarEntidadModal';
import type { DestinoValor } from '../pesaje/material-fila';
import type { Producto, TicketPesaje, ListaPrecios, Lote } from '@shared/types/index.js';

interface Entidad { id: string; nombre: string; activo: boolean; fotoUrl: string | null }
type ModoPeso = 'ticket' | 'manual';

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Una línea del formulario (valores como string para los inputs). */
interface LineaFila {
  uid: number;
  productoId: string;
  peso: string;
  precioUnitario: string;
  /** Viene de un ticket: material y peso bloqueados. */
  desdeTicket: boolean;
  /** id del material del ticket (detalle), para conservar precios al re-seleccionar. */
  materialId?: string;
  /** Solo modo manual: id del lote destino, para el ticket que se genera. */
  destino: DestinoValor;
}

let UID = 0;
function lineaVacia(): LineaFila {
  return { uid: UID++, productoId: '', peso: '', precioUnitario: '', desdeTicket: false, destino: '' };
}

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
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [ticketsPendientes, setTicketsPendientes] = useState<TicketPesaje[]>([]);
  const [listas, setListas] = useState<ListaPrecios[]>([]);

  const [entidadId, setEntidadId] = useState('');
  const [modoPeso, setModoPeso] = useState<ModoPeso>('ticket');
  const [ticketIds, setTicketIds] = useState<string[]>([]);
  const [lineas, setLineas] = useState<LineaFila[]>([lineaVacia()]);
  const [devolucion, setDevolucion] = useState('');
  const [listaSelId, setListaSelId] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [observaciones, setObservaciones] = useState('');

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mostrarSelectorEntidad, setMostrarSelectorEntidad] = useState(false);

  // Precios de la lista elegida (productoId → precio/kg). En ref para poder
  // precargar líneas nuevas (de ticket o manuales) sin re-disparar efectos.
  const preciosLista = useRef<Record<string, number>>({});

  useEffect(() => {
    const cargar = (): Promise<Entidad[]> => (esCompra ? obtenerProveedores() : obtenerClientes());
    cargar().then(lista => setEntidades(lista.filter(e => e.activo)));
    obtenerProductos().then(lista => setProductos(lista.filter(p => p.activo)));
    obtenerListas(tipo).then(lista => setListas(lista.filter(l => l.activo)));
    obtenerLotes().then(lista => setLotes(lista.filter(l => l.activo)));
  }, [esCompra, tipo]);

  useEffect(() => {
    // El setState del early-return es real, no redundante: limpia la lista de
    // tickets cuando el usuario DESELECCIONA la entidad después de haber
    // elegido una (no solo en el mount, donde ya arranca en []).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!entidadId) { setTicketsPendientes([]); return; }
    obtenerTickets({ soloNoFacturados: true, entidadId, tipo }).then(setTicketsPendientes);
  }, [entidadId, tipo]);

  const ticketsSel = useMemo(
    () => ticketsPendientes.filter(t => ticketIds.includes(t.id)),
    [ticketsPendientes, ticketIds]
  );

  // Precio que define la lista elegida para un material (string vacío si no hay).
  const precioDeLista = (productoId: string): string => {
    const p = preciosLista.current[productoId];
    return p != null ? String(p) : '';
  };

  // Al (de)seleccionar tickets, reconstruir las líneas: una por material de cada
  // ticket elegido. Se conservan los precios ya escritos (match por materialId);
  // los nuevos se precargan con el precio de la lista elegida (si hay).
  useEffect(() => {
    if (modoPeso !== 'ticket') return;
    // Reconstruye las líneas fusionando con las anteriores (conserva precios ya
    // escritos a mano) — es una sincronización real con los tickets seleccionados,
    // no una inicialización que se pueda mover a render/useMemo sin perder ese merge.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLineas(prev => {
      const previos = new Map(prev.filter(l => l.materialId).map(l => [l.materialId!, l]));
      const nuevas: LineaFila[] = ticketsSel.flatMap(t =>
        t.materiales.map(m => {
          const ex = previos.get(m.id);
          return {
            uid: ex?.uid ?? UID++,
            productoId: m.productoId ?? '',
            peso: String(m.pesoNeto),
            precioUnitario: ex?.precioUnitario || precioDeLista(m.productoId ?? ''),
            desdeTicket: true,
            materialId: m.id,
            destino: '',
          };
        })
      );
      return nuevas.length > 0 ? nuevas : [lineaVacia()];
    });
  }, [ticketsSel, modoPeso]);

  const toggleTicket = (id: string) =>
    setTicketIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const cambiarModo = (m: ModoPeso) => {
    setModoPeso(m);
    setTicketIds([]);
    setLineas([lineaVacia()]);
    setDevolucion('');
  };

  const setLinea = (uid: number, campo: keyof LineaFila, valor: string) =>
    setLineas(prev => prev.map(l => (l.uid === uid ? { ...l, [campo]: valor } : l)));

  // Al elegir material en una línea manual, autocompletar su precio desde la lista.
  const setMaterialLinea = (uid: number, productoId: string) =>
    setLineas(prev => prev.map(l => {
      if (l.uid !== uid) return l;
      const precio = precioDeLista(productoId);
      return { ...l, productoId, precioUnitario: precio || l.precioUnitario };
    }));

  // Elegir lista global: carga sus precios y autocompleta TODAS las líneas.
  const aplicarLista = async (id: string) => {
    setListaSelId(id);
    if (!id) { preciosLista.current = {}; return; }
    const detalle = await obtenerListaDetalle(id);
    const mapa: Record<string, number> = {};
    (detalle?.precios ?? []).forEach(p => { mapa[p.productoId] = p.precio; });
    preciosLista.current = mapa;
    setLineas(prev => prev.map(l => {
      const precio = mapa[l.productoId];
      return precio != null ? { ...l, precioUnitario: String(precio) } : l;
    }));
  };

  const agregarLinea = () => setLineas(prev => [...prev, lineaVacia()]);
  const quitarLinea = (uid: number) =>
    setLineas(prev => (prev.length > 1 ? prev.filter(l => l.uid !== uid) : prev));

  const subtotalLinea = (l: LineaFila) => (Number(l.peso) || 0) * (Number(l.precioUnitario) || 0);
  const total = useMemo(() => lineas.reduce((acc, l) => acc + subtotalLinea(l), 0), [lineas]);

  /** true si el material pertenece a una categoría "sin lote" (ej. No
   *  Ferroso, Bloque 47) — no pide lote, va directo a inventario general. */
  const esSinLote = (productoId: string): boolean =>
    productos.find(p => p.id === productoId)?.tipoMaterialSinLote === true;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!entidadId) { setError(`Elige un ${labelEntidad.toLowerCase()}.`); return; }
    if (modoPeso === 'ticket' && ticketIds.length === 0) { setError('Selecciona al menos un ticket de pesaje o cambia a peso manual.'); return; }
    if (lineas.some(l => !l.productoId)) { setError('Selecciona un material en cada fila.'); return; }
    if (modoPeso === 'manual' && lineas.some(l => !esSinLote(l.productoId) && !l.destino)) { setError('Selecciona el destino de inventario en cada fila.'); return; }
    if (lineas.some(l => (Number(l.peso) || 0) <= 0)) { setError('Cada material debe tener un peso mayor a 0.'); return; }
    if (lineas.some(l => (Number(l.precioUnitario) || 0) <= 0)) { setError('Cada material debe tener un precio unitario mayor a 0.'); return; }

    setGuardando(true);

    // En modo manual, el peso siempre genera su propio ticket de pesaje (con
    // devolución y destino de inventario), igual que si se hubiera cargado
    // desde la pestaña Pesaje — así el material sí se contabiliza en el
    // inventario y queda el documento del ticket.
    let ticketIdsAEnviar = ticketIds;
    if (modoPeso === 'manual') {
      const pesoTotal = lineas.reduce((acc, l) => acc + (Number(l.peso) || 0), 0);
      const devolucionNum = Number(devolucion) || 0;
      const resultTicket = await crearTicket({
        tipo,
        entidadId,
        fecha: hoyISO(),
        pesoGlobal: pesoTotal + devolucionNum,
        devolucion: devolucionNum,
        estado: 'completo',
        materiales: lineas.map(l => ({
          productoId: l.productoId,
          pesoBruto: Number(l.peso) || 0,
          tara: 0,
          destinoTipo: esSinLote(l.productoId) ? ('mpp' as const) : ('lote' as const),
          loteId: esSinLote(l.productoId) ? null : l.destino,
        })),
        fotos: [],
      });
      if ('error' in resultTicket) {
        setError(resultTicket.error);
        setGuardando(false);
        return;
      }
      ticketIdsAEnviar = [resultTicket.ticket.id];
    }

    const result = await crearFactura(tipo, {
      entidadId,
      ticketIds: ticketIdsAEnviar,
      items: lineas.map(l => ({
        productoId: l.productoId,
        peso: Number(l.peso),
        precioUnitario: Number(l.precioUnitario),
      })),
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
  const nombreProducto = (id: string) => productos.find(p => p.id === id)?.nombre ?? 'material';

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
          <button
            type="button"
            onClick={() => setMostrarSelectorEntidad(true)}
            className={`${inputClass} flex items-center justify-between gap-2 text-left`}
          >
            <span className={entidadId ? 'text-text-primary truncate' : 'text-text-muted'}>
              {entidades.find(e => e.id === entidadId)?.nombre ?? '— Selecciona —'}
            </span>
            <ChevronDown size={14} className="text-text-muted shrink-0" />
          </button>
        </div>

        <div>
          <label className={labelClass}>Lista de precios</label>
          <select value={listaSelId} onChange={e => aplicarLista(e.target.value)} className={inputClass}>
            <option value="">Seleccionar lista de precios</option>
            {listas.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
          <p className="text-xs text-text-muted mt-1">
            Autocompleta el precio de cada material según la lista. Puedes editarlo después a mano.
          </p>
        </div>

        <div>
          <label className={labelClass}>Origen del peso</label>
          <div className="flex rounded-lg overflow-hidden border border-border text-sm w-fit mb-3">
            <button type="button" onClick={() => cambiarModo('ticket')} className={`px-4 py-1.5 ${modoPeso === 'ticket' ? 'bg-brand-600 text-white' : 'bg-surface-alt text-text-secondary'}`}>
              Ticket de pesaje
            </button>
            <button type="button" onClick={() => cambiarModo('manual')} className={`px-4 py-1.5 ${modoPeso === 'manual' ? 'bg-brand-600 text-white' : 'bg-surface-alt text-text-secondary'}`}>
              Peso manual
            </button>
          </div>

          {modoPeso === 'ticket' && (
            !entidadId ? (
              <p className="text-xs text-text-muted">Elige primero un {labelEntidad.toLowerCase()}.</p>
            ) : ticketsPendientes.length === 0 ? (
              <p className="text-xs text-text-muted">Sin tickets pendientes para este {labelEntidad.toLowerCase()}.</p>
            ) : (
              <div className="border border-border rounded-lg divide-y divide-border max-h-56 overflow-y-auto">
                {ticketsPendientes.map(t => (
                  <label key={t.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-surface-alt transition-colors">
                    <input
                      type="checkbox"
                      checked={ticketIds.includes(t.id)}
                      onChange={() => toggleTicket(t.id)}
                      className="w-4 h-4 accent-brand-600 shrink-0"
                    />
                    <span className="text-sm text-text-primary">
                      <span className="font-medium">{t.codigo}</span>
                      <span className="text-text-muted"> · {t.fecha ?? '—'} · {t.materiales.length === 1 ? (t.materiales[0].nombreProducto ?? 'material') : `${t.materiales.length} materiales`} · {fmt(t.pesoNetoTotal)} kg</span>
                    </span>
                  </label>
                ))}
              </div>
            )
          )}
          {modoPeso === 'ticket' && ticketIds.length > 0 && (
            <p className="text-xs text-text-muted mt-2">{ticketIds.length} ticket{ticketIds.length === 1 ? '' : 's'} seleccionado{ticketIds.length === 1 ? '' : 's'}.</p>
          )}
          {modoPeso === 'manual' && (
            <p className="text-xs text-text-muted">
              Se genera automáticamente su propio ticket de pesaje con estos materiales (con destino de inventario y devolución).
            </p>
          )}
        </div>

        {/* Líneas de la factura */}
        <div className="space-y-3">
          <label className={labelClass + ' mb-0'}>Materiales {modoPeso === 'ticket' && ticketsSel.length > 0 ? '(de los tickets)' : ''}</label>

          {modoPeso === 'ticket' && ticketsSel.length === 0 ? (
            <p className="text-xs text-text-muted">Selecciona uno o más tickets para cargar sus materiales.</p>
          ) : (
            lineas.map((l, idx) => (
              <div key={l.uid} className="border border-border rounded-lg p-3 space-y-3 bg-surface-alt/40">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-text-secondary">
                    Material {idx + 1}{l.desdeTicket ? ` · ${nombreProducto(l.productoId)}` : ''}
                  </span>
                  {modoPeso === 'manual' && lineas.length > 1 && (
                    <button type="button" onClick={() => quitarLinea(l.uid)} className="text-text-muted hover:text-red-600 transition-colors" title="Quitar material">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>

                {!l.desdeTicket && (
                  <div>
                    <label className={labelClass}>Material *</label>
                    <select value={l.productoId} onChange={e => setMaterialLinea(l.uid, e.target.value)} className={inputClass}>
                      <option value="">— Selecciona —</option>
                      {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                  </div>
                )}

                {modoPeso === 'manual' && (
                  esSinLote(l.productoId) ? (
                    <p className="text-xs text-text-muted bg-surface-alt border border-border rounded-lg px-3 py-2">
                      "{productos.find(p => p.id === l.productoId)?.tipoMaterialNombre}" es una categoría sin lote — este material va directo a inventario general, no pide lote.
                    </p>
                  ) : (
                    <div>
                      <label className={labelClass}>{esCompra ? 'Destino (inventario) *' : 'Origen (inventario) *'}</label>
                      <select required value={l.destino} onChange={e => setLinea(l.uid, 'destino', e.target.value)} className={inputClass}>
                        <option value="" disabled>-Selecciona-</option>
                        {lotes.map(lo => <option key={lo.id} value={lo.id}>{lo.nombre}</option>)}
                      </select>
                      <p className="text-xs text-text-muted mt-1">
                        {esCompra ? 'A qué lote entra este material comprado.' : 'De qué lote sale este material vendido.'}
                      </p>
                    </div>
                  )
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Peso (kg) {l.desdeTicket && <span className="text-text-muted">· del ticket</span>}</label>
                    <input type="number" step="0.001" min="0" value={l.peso} onChange={e => setLinea(l.uid, 'peso', e.target.value)} className={inputClass} placeholder="0.00" disabled={l.desdeTicket} />
                  </div>
                  <div>
                    <label className={labelClass}>Precio (kg) *</label>
                    <input type="number" step="0.01" min="0" value={l.precioUnitario} onChange={e => setLinea(l.uid, 'precioUnitario', e.target.value)} className={inputClass} placeholder="0.00" />
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">Subtotal</span>
                  <span className="font-semibold text-text-primary">{fmt(subtotalLinea(l))}</span>
                </div>
              </div>
            ))
          )}

          {modoPeso === 'manual' && (
            <button type="button" onClick={agregarLinea} className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors">
              <Plus size={16} />
              Agregar material
            </button>
          )}

          {modoPeso === 'manual' && (
            <div className="bg-brand-50 border border-brand-200 rounded-lg px-4 py-3 space-y-1">
              <div className="flex items-center justify-between gap-3 text-sm">
                <label htmlFor="devolucion-manual" className="text-brand-800 shrink-0">Devolución (kg)</label>
                <input
                  id="devolucion-manual"
                  type="number"
                  step="0.01"
                  min="0"
                  value={devolucion}
                  onChange={e => setDevolucion(e.target.value)}
                  className="w-28 px-2 py-1 bg-surface border border-brand-200 rounded-md text-sm text-right focus:outline-none focus:ring-2 focus:ring-brand-400"
                  placeholder="0.00"
                />
              </div>
              <p className="text-[11px] text-brand-700/80">
                Kg que {esCompra ? 'el proveedor se lleva' : 'el cliente se lleva'} de vuelta. Va en el ticket que se genera, no afecta el inventario ni la factura.
              </p>
            </div>
          )}
        </div>

        <div>
          <label className={labelClass}>Descripción</label>
          <input type="text" value={descripcion} onChange={e => setDescripcion(e.target.value)} className={inputClass} placeholder="Opcional" />
        </div>
        <div>
          <label className={labelClass}>Observaciones</label>
          <textarea value={observaciones} onChange={e => setObservaciones(e.target.value)} className={`${inputClass} resize-none`} rows={2} placeholder="Opcional" />
        </div>

        <div className="flex items-center justify-end bg-brand-50 border border-brand-200 rounded-lg px-4 py-3">
          <div className="text-right">
            <p className="text-xs text-brand-700">Total ({lineas.length} {lineas.length === 1 ? 'material' : 'materiales'})</p>
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

      {mostrarSelectorEntidad && (
        <SeleccionarEntidadModal
          titulo={`Elegir ${labelEntidad.toLowerCase()}`}
          entidades={entidades}
          onClose={() => setMostrarSelectorEntidad(false)}
          onSeleccionar={id => {
            setEntidadId(id);
            setTicketIds([]);
            setMostrarSelectorEntidad(false);
          }}
        />
      )}
    </div>
  );
}

export default FacturaFormPage;
