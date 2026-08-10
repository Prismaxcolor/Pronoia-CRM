import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Scale, ImagePlus, X, Loader2, Plus, Trash2, PackageOpen, Search, ChevronDown, AlertTriangle } from 'lucide-react';
import { obtenerProveedores } from '../../services/proveedor-service';
import { obtenerClientes } from '../../services/cliente-service';
import { obtenerProductos } from '../../services/producto-service';
import { obtenerTickets, crearTicket, borrarTicket } from '../../services/ticket-pesaje-service';
import { obtenerLotes } from '../../services/lote-service';
import { obtenerTaras } from '../../services/tara-service';
import { obtenerAlmacenes, obtenerStockAlmacen } from '../../services/almacen-service';
import { crearTraslado, obtenerTraslados } from '../../services/traslado-service';
import { subirFotoTicket } from '../../services/storage-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { useConfirm } from '../../hooks/use-confirm-context';
import CompletarTicketModal from './CompletarTicketModal';
import CompletarTrasladoModal from '../inventario/CompletarTrasladoModal';
import SeleccionarMaterialModal from './SeleccionarMaterialModal';
import SeleccionarTaraModal from './SeleccionarTaraModal';
import { filaVacia, taraKgFila, netoFila, type MaterialFila } from './material-fila';
import { coincideCodigo, type Producto, type TicketPesaje, type Lote, type Tara, type Almacen, type Traslado } from '@shared/types/index.js';

/** Fila unificada de la lista de "Tickets": un pesaje (compra/venta) o un
 *  traslado entre almacenes, mostrados juntos porque ambos son operaciones
 *  de Pesaje — el traslado ya no vive solo en Inventario. */
type FilaListado =
  | { kind: 'pesaje'; ticket: TicketPesaje }
  | { kind: 'traslado'; traslado: Traslado };

interface FotoLocal { file: File; preview: string }
interface Entidad { id: string; nombre: string; activo: boolean }
type TipoPesaje = 'compra' | 'venta' | 'traslado';

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

type Pestana = 'nuevo' | 'tickets';

function PesajePage() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const confirmar = useConfirm();
  const navigate = useNavigate();
  const puedeCrear = tienePermiso('pesaje', 'crear');
  const puedeEliminarTicket = tienePermiso('pesaje', 'eliminar');
  const puedeRecepcionarTraslado = tienePermiso('traslados', 'crear');
  const puedeVerTickets = tienePermiso('pesaje', 'ver') && tienePermiso('facturacion', 'ver');

  const [pestana, setPestana] = useState<Pestana>('nuevo');
  const [proveedores, setProveedores] = useState<Entidad[]>([]);
  const [clientes, setClientes] = useState<Entidad[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [taras, setTaras] = useState<Tara[]>([]);
  const [tickets, setTickets] = useState<TicketPesaje[]>([]);
  const [traslados, setTraslados] = useState<Traslado[]>([]);
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [stockOrigen, setStockOrigen] = useState<Map<string, number>>(new Map());

  const [tipo, setTipo] = useState<TipoPesaje>('compra');
  const [entidadId, setEntidadId] = useState('');
  const [almacenOrigenId, setAlmacenOrigenId] = useState('');
  const [almacenDestinoId, setAlmacenDestinoId] = useState('');
  const [fecha, setFecha] = useState(hoyISO());
  const [pesoGlobal, setPesoGlobal] = useState('');
  const [devolucion, setDevolucion] = useState('');
  const [materiales, setMateriales] = useState<MaterialFila[]>([filaVacia()]);
  const [observaciones, setObservaciones] = useState('');
  const [fotos, setFotos] = useState<FotoLocal[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticketACompletar, setTicketACompletar] = useState<TicketPesaje | null>(null);
  const [trasladoARecepcionar, setTrasladoARecepcionar] = useState<Traslado | null>(null);
  const [filaActivaUid, setFilaActivaUid] = useState<number | null>(null);
  const [buscaCodigo, setBuscaCodigo] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<'todos' | 'compra' | 'venta' | 'traslado'>('todos');
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'bruto' | 'pendiente' | 'facturado'>('todos');
  const [mostrarSelectorMaterial, setMostrarSelectorMaterial] = useState(false);
  const [mostrarSelectorTara, setMostrarSelectorTara] = useState(false);

  const cargarTickets = () => { obtenerTickets().then(setTickets); };
  const cargarTraslados = () => { obtenerTraslados().then(setTraslados); };

  useEffect(() => {
    obtenerProveedores().then(lista => setProveedores(lista.filter(p => p.activo)));
    obtenerClientes().then(lista => setClientes(lista.filter(c => c.activo)));
    obtenerProductos().then(lista => setProductos(lista.filter(p => p.activo)));
    obtenerLotes().then(lista => setLotes(lista.filter(l => l.activo)));
    obtenerTaras().then(lista => setTaras(lista.filter(t => t.activo)));
    cargarTickets();
    cargarTraslados();
  }, []);

  // Stock del almacén de origen elegido, para avisar (sin bloquear) si un
  // traslado deja el material en negativo.
  useEffect(() => {
    const promesa = tipo === 'traslado' && almacenOrigenId
      ? obtenerStockAlmacen(almacenOrigenId)
      : Promise.resolve(new Map<string, number>());
    promesa.then(setStockOrigen);
  }, [tipo, almacenOrigenId]);

  const entidades = tipo === 'compra' ? proveedores : clientes;
  const labelEntidad = tipo === 'compra' ? 'Proveedor' : 'Cliente';
  const almacenPredeterminado = almacenes.find(a => a.esPredeterminado);

  // Recarga la lista de almacenes al cambiar de pestaña de tipo — si la
  // estrella se movió desde otra pantalla, se refleja sin recargar la página.
  useEffect(() => {
    obtenerAlmacenes().then(lista => setAlmacenes(lista.filter(a => a.activo)));
  }, [tipo]);

  // Mapa id→nombre de proveedores + clientes (para la tabla de tickets recientes)
  const nombrePorEntidad = useMemo(() => {
    const m = new Map<string, string>();
    [...proveedores, ...clientes].forEach(e => m.set(e.id, e.nombre));
    return m;
  }, [proveedores, clientes]);

  const pesoNetoTotal = useMemo(
    () => materiales.reduce((acc, f) => acc + netoFila(f, taras), 0),
    [materiales, taras]
  );

  // Diferencia = Peso Global - suma de materiales netos - devolución.
  const diferencia = useMemo(
    () => (Number(pesoGlobal) || 0) - pesoNetoTotal - (Number(devolucion) || 0),
    [pesoGlobal, pesoNetoTotal, devolucion]
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
    setAlmacenOrigenId('');
    setAlmacenDestinoId('');
    setFecha(hoyISO());
    setPesoGlobal('');
    setDevolucion('');
    setMateriales([filaVacia()]);
    setObservaciones('');
    setFotos([]);
  };

  const guardarTraslado = async () => {
    setError(null);

    if (!almacenOrigenId) { setError('Elige el almacén de origen.'); return; }
    if (!almacenDestinoId) { setError('Elige el almacén de destino.'); return; }
    if (almacenOrigenId === almacenDestinoId) { setError('El almacén de origen y destino no pueden ser el mismo.'); return; }
    if (materiales.some(f => !f.productoId)) { setError('Cada material debe tener un producto seleccionado.'); return; }
    if (materiales.some(f => netoFila(f, taras) < 0)) { setError('El peso neto de un material no puede ser negativo. Revisa bruto y tara.'); return; }
    if (materiales.some(f => netoFila(f, taras) <= 0)) { setError('Cada material debe tener un peso neto mayor a 0.'); return; }

    setGuardando(true);
    const result = await crearTraslado({
      almacenOrigenId,
      almacenDestinoId,
      materiales: materiales.map(f => ({
        productoId: f.productoId,
        subcategoria: f.subcategoria.trim() || null,
        pesoBruto: Number(f.pesoBruto) || 0,
        tara: taraKgFila(f, taras),
      })),
      observaciones: observaciones.trim() || null,
    });
    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    toast.exito(`${result.traslado.codigo} generado (${fmt(result.traslado.pesoNetoEnviado)} kg). Queda pendiente hasta que el almacén destino confirme la recepción.`);
    limpiar();
  };

  const guardar = async (estado: 'bruto' | 'completo') => {
    setError(null);

    if (!entidadId) { setError(`Elige un ${labelEntidad.toLowerCase()}.`); return; }
    if (!pesoGlobal || Number(pesoGlobal) <= 0) { setError('Registra el peso global de la pesada.'); return; }
    if (estado === 'completo') {
      if (materiales.some(f => !f.productoId)) { setError('Cada material debe tener un producto seleccionado.'); return; }
      if (materiales.some(f => f.taraModo === 'preconfigurada' && Number(f.taraCantidad) > 0 && !f.taraId)) {
        setError('Selecciona la tara preconfigurada para las unidades ingresadas.');
        return;
      }
      if (materiales.some(f => netoFila(f, taras) < 0)) { setError('El peso neto de un material no puede ser negativo. Revisa bruto y tara.'); return; }
      if (materiales.some(f => netoFila(f, taras) <= 0)) { setError('Cada material debe tener un peso neto mayor a 0.'); return; }
    }

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
      tipo: tipo === 'venta' ? 'venta' : 'compra',
      entidadId,
      fecha,
      pesoGlobal: Number(pesoGlobal) || 0,
      devolucion: Number(devolucion) || 0,
      estado,
      materiales: estado === 'bruto' ? [] : materiales.map(f => ({
        productoId: f.productoId,
        subcategoria: f.subcategoria.trim() || null,
        pesoBruto: Number(f.pesoBruto) || 0,
        tara: taraKgFila(f, taras),
        destinoTipo: f.destino === 'mpp' ? ('mpp' as const) : ('lote' as const),
        loteId: f.destino === 'mpp' ? null : f.destino,
      })),
      fotos: urls,
      observaciones: observaciones.trim() || null,
    });

    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    toast.exito(
      estado === 'bruto'
        ? `${result.ticket.codigo} guardado en bruto. Complétalo luego desde la lista.`
        : `${result.ticket.codigo} generado (neto ${fmt(result.ticket.pesoNetoTotal)} kg).`
    );
    limpiar();
    cargarTickets();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (tipo === 'traslado') { guardarTraslado(); return; }
    guardar('completo');
  };

  const handleEliminarTicket = async (t: TicketPesaje) => {
    const ok = await confirmar({
      titulo: 'Eliminar ticket',
      mensaje: `¿Eliminar el ticket ${t.codigo}? Esta acción no se puede deshacer.`,
      confirmarLabel: 'Eliminar',
      variante: 'danger',
    });
    if (!ok) return;
    const result = await borrarTicket(t.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`${t.codigo} eliminado.`);
    cargarTickets();
  };

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";
  const fmt = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const filaActiva = materiales.find(f => f.uid === filaActivaUid) ?? materiales[0];

  // Traslados pasan el filtro de tipo solo si se pidió explícitamente 'traslado'
  // o 'todos' — no tienen tipo compra/venta, así que 'compra'/'venta' los excluye.
  const trasladosFiltrados = useMemo(
    () => (filtroTipo === 'compra' || filtroTipo === 'venta')
      ? []
      : traslados.filter(t => coincideCodigo(t.codigo, buscaCodigo)),
    [traslados, buscaCodigo, filtroTipo]
  );
  const ticketsFiltrados = useMemo(
    () => filtroTipo === 'traslado'
      ? []
      : tickets.filter(t =>
          coincideCodigo(t.codigo, buscaCodigo) && (filtroTipo === 'todos' || t.tipo === filtroTipo)
        ),
    [tickets, buscaCodigo, filtroTipo]
  );
  // "Por recepcionar" = tickets en bruto + traslados pendientes (mismo
  // concepto: la operación ya se registró pero falta que alguien la confirme).
  const filasBruto = useMemo((): FilaListado[] => {
    const deTickets: FilaListado[] = (filtroEstado === 'todos' || filtroEstado === 'bruto')
      ? ticketsFiltrados.filter(t => t.estado === 'bruto').map(ticket => ({ kind: 'pesaje' as const, ticket }))
      : [];
    const deTraslados: FilaListado[] = (filtroEstado === 'todos' || filtroEstado === 'bruto')
      ? trasladosFiltrados.filter(t => t.estado === 'pendiente').map(traslado => ({ kind: 'traslado' as const, traslado }))
      : [];
    return [...deTickets, ...deTraslados];
  }, [ticketsFiltrados, trasladosFiltrados, filtroEstado]);
  // "Pendientes por facturar / Facturados" — los traslados nunca se facturan,
  // así que solo aparecen ahí cuando el filtro es 'todos' (no tiene sentido
  // pedirle "traslados facturados", ese estado no existe para ellos).
  const filasCompletos = useMemo((): FilaListado[] => {
    if (filtroEstado === 'bruto') return [];
    const deTickets: FilaListado[] = ticketsFiltrados
      .filter(t => {
        if (t.estado !== 'completo') return false;
        if (filtroEstado === 'pendiente') return !t.facturado;
        if (filtroEstado === 'facturado') return t.facturado;
        return true;
      })
      .map(ticket => ({ kind: 'pesaje' as const, ticket }));
    const deTraslados: FilaListado[] = filtroEstado === 'todos'
      ? trasladosFiltrados.filter(t => t.estado === 'completo').map(traslado => ({ kind: 'traslado' as const, traslado }))
      : [];
    return [...deTickets, ...deTraslados];
  }, [ticketsFiltrados, trasladosFiltrados, filtroEstado]);
  const totalPendientePorRecepcionar = useMemo(
    () => filasBruto.reduce((acc, f) => acc + (f.kind === 'pesaje' ? f.ticket.pesoGlobal : f.traslado.pesoNetoEnviado), 0),
    [filasBruto]
  );

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
            {/* Toggle compra/venta/traslado */}
            <div>
              <label className={labelClass}>Tipo de operación</label>
              <div className="flex rounded-lg overflow-hidden border border-border text-sm w-fit">
                <button type="button" onClick={() => { setTipo('compra'); setEntidadId(''); }} className={`px-4 py-1.5 ${tipo === 'compra' ? 'bg-brand-600 text-white' : 'bg-surface-alt text-text-secondary'}`}>
                  Compra (proveedor)
                </button>
                <button type="button" onClick={() => { setTipo('venta'); setEntidadId(''); }} className={`px-4 py-1.5 ${tipo === 'venta' ? 'bg-brand-600 text-white' : 'bg-surface-alt text-text-secondary'}`}>
                  Venta (cliente)
                </button>
                <button type="button" onClick={() => { setTipo('traslado'); setEntidadId(''); }} className={`px-4 py-1.5 ${tipo === 'traslado' ? 'bg-brand-600 text-white' : 'bg-surface-alt text-text-secondary'}`}>
                  Traslado (almacén)
                </button>
              </div>
            </div>

            {tipo === 'traslado' ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Almacén origen *</label>
                  <select value={almacenOrigenId} onChange={e => setAlmacenOrigenId(e.target.value)} className={inputClass}>
                    <option value="">— Selecciona —</option>
                    {almacenes.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Almacén destino *</label>
                  <select value={almacenDestinoId} onChange={e => setAlmacenDestinoId(e.target.value)} className={inputClass}>
                    <option value="">— Selecciona —</option>
                    {almacenes.filter(a => a.id !== almacenOrigenId).map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                  </select>
                </div>
              </div>
            ) : (
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
            )}

            {tipo !== 'traslado' && (
              almacenPredeterminado ? (
                <div className="select-none px-3 py-2 bg-surface-alt border border-border rounded-lg">
                  <p className="text-sm font-medium text-text-primary">Almacén: {almacenPredeterminado.nombre}</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {tipo === 'compra'
                      ? 'Esta compra entra al inventario de este almacén.'
                      : 'Esta venta sale del inventario de este almacén.'}
                  </p>
                </div>
              ) : (
                <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-800">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                  <p className="text-xs">Ningún almacén está marcado como predeterminado — este pesaje no afectará a ningún almacén.</p>
                </div>
              )
            )}

            {tipo !== 'traslado' && (
            <div>
              <label className={labelClass}>Peso global (kg) *</label>
              <input type="number" step="0.01" min="0" value={pesoGlobal} onChange={e => setPesoGlobal(e.target.value)} className={inputClass} placeholder="0.00" />
              <p className="text-xs text-text-muted mt-1">Pesaje único de todos los materiales juntos, al llegar el proveedor.</p>
            </div>
            )}

            {/* Materiales */}
            <div className="space-y-3">
              <label className={labelClass + ' mb-0'}>Materiales</label>

              {materiales.map((f, idx) => {
                const neto = netoFila(f, taras);
                return (
                  <div
                    key={f.uid}
                    onFocusCapture={() => setFilaActivaUid(f.uid)}
                    onClick={() => setFilaActivaUid(f.uid)}
                    className="border border-border rounded-lg p-3 space-y-3 bg-surface-alt/40"
                  >
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
                        <button
                          type="button"
                          onClick={() => { setFilaActivaUid(f.uid); setMostrarSelectorMaterial(true); }}
                          className={`${inputClass} flex items-center justify-between gap-2 text-left`}
                        >
                          <span className={f.productoId ? 'text-text-primary truncate' : 'text-text-muted'}>
                            {productos.find(p => p.id === f.productoId)?.nombre ?? '— Selecciona —'}
                          </span>
                          <ChevronDown size={14} className="text-text-muted shrink-0" />
                        </button>
                      </div>
                      <div>
                        <label className={labelClass}>Subcategoría / detalle</label>
                        <input type="text" value={f.subcategoria} onChange={e => setFila(f.uid, 'subcategoria', e.target.value)} className={inputClass} placeholder="Ej. PCB media densidad" />
                      </div>
                    </div>

                    {tipo !== 'traslado' && (
                    <div>
                      <label className={labelClass}>{tipo === 'venta' ? 'Origen (inventario) *' : 'Destino (inventario) *'}</label>
                      <select value={f.destino} onChange={e => setFila(f.uid, 'destino', e.target.value)} className={inputClass}>
                        <option value="mpp">MPP (Material Por Procesar)</option>
                        {lotes.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                      </select>
                      <p className="text-xs text-text-muted mt-1">
                        {tipo === 'venta' ? 'De qué lote (o MPP) sale este material vendido.' : 'A qué lote (o MPP) entra este material comprado.'}
                      </p>
                    </div>
                    )}

                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 items-center">
                      {/* Las 4 celdas son hermanas directas del grid (no divs anidados por
                          columna) a propósito: así CSS Grid iguala la altura de la fila 1
                          (labels) entre ambas columnas automáticamente, sin importar que la
                          de Tara traiga el toggle Preconfigurada/Manual y la de Peso bruto
                          no — evita que los inputs de la fila 2 queden a distinta altura. */}
                      <label className="text-xs font-medium text-text-secondary">Peso bruto (kg)</label>
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-medium text-text-secondary">Tara</label>
                        <div className="flex rounded-md overflow-hidden border border-border text-[11px] shrink-0">
                          <button type="button" onClick={() => setFila(f.uid, 'taraModo', 'preconfigurada')} className={`px-2 py-1 ${f.taraModo === 'preconfigurada' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
                            Preconfigurada
                          </button>
                          <button type="button" onClick={() => setFila(f.uid, 'taraModo', 'manual')} className={`px-2 py-1 ${f.taraModo === 'manual' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
                            Manual
                          </button>
                        </div>
                      </div>

                      <input type="number" step="0.01" min="0" value={f.pesoBruto} onChange={e => setFila(f.uid, 'pesoBruto', e.target.value)} className={inputClass + ' self-start'} placeholder="0.00" />
                      <div className="self-start">
                        {f.taraModo === 'preconfigurada' ? (
                          <div>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={() => { setFilaActivaUid(f.uid); setMostrarSelectorTara(true); }}
                                className={`${inputClass} flex items-center justify-between gap-1 text-left`}
                              >
                                <span className={f.taraId ? 'text-text-primary truncate' : 'text-text-muted'}>
                                  {taras.find(t => t.id === f.taraId)?.nombre ?? '— Tara —'}
                                </span>
                                <ChevronDown size={14} className="text-text-muted shrink-0" />
                              </button>
                              <input type="number" step="1" min="0" value={f.taraCantidad} onChange={e => setFila(f.uid, 'taraCantidad', e.target.value)} className={inputClass} placeholder="Cantidad" />
                            </div>
                            <p className="text-[11px] text-text-muted mt-1">= {fmt(taraKgFila(f, taras))} kg</p>
                          </div>
                        ) : (
                          <input type="number" step="0.01" min="0" value={f.taraManual} onChange={e => setFila(f.uid, 'taraManual', e.target.value)} className={inputClass} placeholder="0.00" />
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-sm">
                      <span className="text-text-muted">Neto del material</span>
                      <span className={`font-semibold ${neto < 0 ? 'text-red-600' : 'text-text-primary'}`}>{fmt(neto)} kg</span>
                    </div>

                    {tipo === 'traslado' && f.productoId && (() => {
                      const disponible = stockOrigen.get(f.productoId) ?? 0;
                      if (neto <= disponible) return null;
                      return (
                        <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
                          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                          <span>
                            El almacén de origen solo tiene {fmt(disponible)} kg disponibles de este material — el inventario quedará en {fmt(disponible - neto)} kg.
                          </span>
                        </div>
                      );
                    })()}
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
                <span className={`text-lg font-bold ${pesoNetoTotal < 0 ? 'text-red-600' : 'text-brand-700'}`}>
                  {fmt(pesoNetoTotal)} kg
                </span>
              </div>
              {tipo === 'traslado' ? (
                <p className="text-[11px] text-brand-700/80">
                  Total que sale del almacén de origen. Queda pendiente hasta que el almacén destino confirme la
                  recepción (pestaña Traslados, dentro de Inventario).
                </p>
              ) : (
              <>
              <div className="flex items-center justify-between gap-3 text-sm border-t border-brand-200 pt-2">
                <label htmlFor="devolucion" className="text-brand-800 shrink-0">Devolución (kg)</label>
                <input
                  id="devolucion"
                  type="number"
                  step="0.01"
                  min="0"
                  value={devolucion}
                  onChange={e => setDevolucion(e.target.value)}
                  className="w-28 px-2 py-1 bg-surface border border-brand-200 rounded-md text-sm text-right focus:outline-none focus:ring-2 focus:ring-brand-400"
                  placeholder="0.00"
                />
              </div>
              <p className="text-[11px] text-brand-700/80 -mt-1">
                Kg que el proveedor se lleva de vuelta. Se suma al peso de los materiales para que
                encuadre contra el peso global — no afecta el inventario ni la factura.
              </p>
              <div className="flex items-center justify-between text-sm border-t border-brand-200 pt-2">
                <span className="text-brand-800">Diferencia (global vs. neto + devolución)</span>
                <span className={`font-semibold ${Math.abs(diferencia) > 0.01 ? 'text-amber-600' : 'text-brand-700'}`}>
                  {fmt(diferencia)} kg
                </span>
              </div>
              </>
              )}
            </div>

            {tipo !== 'traslado' && (
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
            )}

            <div>
              <label className={labelClass}>Observaciones</label>
              <textarea value={observaciones} onChange={e => setObservaciones(e.target.value)} className={`${inputClass} resize-none`} rows={2} placeholder="Notas del pesaje" />
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}

            <button type="submit" disabled={guardando} className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando
                ? <><Loader2 size={16} className="animate-spin" /> Guardando...</>
                : tipo === 'traslado' ? 'Generar traslado' : 'Generar ticket de pesaje'}
            </button>

            {tipo === 'compra' && (
              <button
                type="button"
                disabled={guardando}
                onClick={() => guardar('bruto')}
                className="w-full py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
              >
                Guardar en bruto (completar después)
              </button>
            )}

            {tipo !== 'traslado' && (
            <p className="text-xs text-text-muted">
              ¿Prefieres cargar el peso directamente al crear la factura? También puedes hacerlo desde ahí con "Peso manual" — se genera el ticket igual.
            </p>
            )}
          </form>
        ) : (
          <p className="text-text-muted text-sm">No tienes permiso para registrar pesajes.</p>
        )}

        {!puedeVerTickets && (
          <SeccionTickets
            filasBruto={filasBruto}
            filasCompletos={filasCompletos}
            totalPendiente={totalPendientePorRecepcionar}
            nombrePorEntidad={nombrePorEntidad}
            fmt={fmt}
            puedeCrear={puedeCrear}
            puedeEliminar={puedeEliminarTicket}
            buscaCodigo={buscaCodigo}
            onBuscaCodigo={setBuscaCodigo}
            filtroTipo={filtroTipo}
            onFiltroTipo={setFiltroTipo}
            filtroEstado={filtroEstado}
            onFiltroEstado={setFiltroEstado}
            onCompletar={setTicketACompletar}
            onEliminar={handleEliminarTicket}
            onVerDetalle={id => navigate(`/pesaje/${id}`)}
            onRecepcionarTraslado={setTrasladoARecepcionar}
            puedeRecepcionarTraslado={puedeRecepcionarTraslado}
          />
        )}
      </div>
      )}

      {pestana === 'tickets' && puedeVerTickets && (
        <SeccionTickets
          filasBruto={filasBruto}
          filasCompletos={filasCompletos}
          totalPendiente={totalPendientePorRecepcionar}
          nombrePorEntidad={nombrePorEntidad}
          fmt={fmt}
          puedeCrear={puedeCrear}
          puedeEliminar={puedeEliminarTicket}
          buscaCodigo={buscaCodigo}
          onBuscaCodigo={setBuscaCodigo}
          filtroTipo={filtroTipo}
          onFiltroTipo={setFiltroTipo}
          filtroEstado={filtroEstado}
          onFiltroEstado={setFiltroEstado}
          onCompletar={setTicketACompletar}
          onEliminar={handleEliminarTicket}
          onVerDetalle={id => navigate(`/pesaje/${id}`)}
          onRecepcionarTraslado={setTrasladoARecepcionar}
          puedeRecepcionarTraslado={puedeRecepcionarTraslado}
        />
      )}

      {ticketACompletar && (
        <CompletarTicketModal
          ticket={ticketACompletar}
          productos={productos}
          lotes={lotes}
          taras={taras}
          onClose={() => setTicketACompletar(null)}
          onCompletado={cargarTickets}
        />
      )}

      {trasladoARecepcionar && (
        <CompletarTrasladoModal
          traslado={trasladoARecepcionar}
          onClose={() => setTrasladoARecepcionar(null)}
          onCompletado={cargarTraslados}
        />
      )}

      {mostrarSelectorMaterial && (
        <SeleccionarMaterialModal
          productos={productos}
          onClose={() => setMostrarSelectorMaterial(false)}
          onSeleccionar={productoId => {
            const uid = filaActiva?.uid ?? materiales[0].uid;
            setFila(uid, 'productoId', productoId);
            setMostrarSelectorMaterial(false);
          }}
        />
      )}

      {mostrarSelectorTara && (
        <SeleccionarTaraModal
          taras={taras}
          onClose={() => setMostrarSelectorTara(false)}
          onSeleccionar={taraId => {
            const uid = filaActiva?.uid ?? materiales[0].uid;
            setFila(uid, 'taraId', taraId);
            setMostrarSelectorTara(false);
          }}
        />
      )}
    </div>
  );
}

/** Separa estrictamente los tickets "por recepcionar" (bruto) de los ya
 *  completados (pendientes por facturar / facturados), con un totalizador
 *  destacado del material pendiente por recepcionar. */
function SeccionTickets({
  filasBruto,
  filasCompletos,
  totalPendiente,
  nombrePorEntidad,
  fmt,
  puedeCrear,
  puedeEliminar,
  puedeRecepcionarTraslado,
  buscaCodigo,
  onBuscaCodigo,
  filtroTipo,
  onFiltroTipo,
  filtroEstado,
  onFiltroEstado,
  onCompletar,
  onEliminar,
  onVerDetalle,
  onRecepcionarTraslado,
}: {
  filasBruto: FilaListado[];
  filasCompletos: FilaListado[];
  totalPendiente: number;
  nombrePorEntidad: Map<string, string>;
  fmt: (n: number) => string;
  puedeCrear: boolean;
  puedeEliminar: boolean;
  puedeRecepcionarTraslado: boolean;
  buscaCodigo: string;
  onBuscaCodigo: (v: string) => void;
  filtroTipo: 'todos' | 'compra' | 'venta' | 'traslado';
  onFiltroTipo: (v: 'todos' | 'compra' | 'venta' | 'traslado') => void;
  filtroEstado: 'todos' | 'bruto' | 'pendiente' | 'facturado';
  onFiltroEstado: (v: 'todos' | 'bruto' | 'pendiente' | 'facturado') => void;
  onCompletar: (t: TicketPesaje) => void;
  onEliminar: (t: TicketPesaje) => void;
  onVerDetalle: (id: string) => void;
  onRecepcionarTraslado: (t: Traslado) => void;
}) {
  const filtroActivo = filtroTipo !== 'todos' || filtroEstado !== 'todos';
  const selectFiltroClass = "px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="search"
            value={buscaCodigo}
            onChange={e => onBuscaCodigo(e.target.value)}
            placeholder="Buscar por N° de control..."
            className="w-full pl-9 pr-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
          />
          {buscaCodigo && (
            <button
              type="button"
              onClick={() => onBuscaCodigo('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted hover:text-text-primary"
            >
              Limpiar
            </button>
          )}
        </div>

        <select value={filtroTipo} onChange={e => onFiltroTipo(e.target.value as typeof filtroTipo)} className={selectFiltroClass}>
          <option value="todos">Todos los tipos</option>
          <option value="compra">Solo compra</option>
          <option value="venta">Solo venta</option>
          <option value="traslado">Solo traslado</option>
        </select>

        <select value={filtroEstado} onChange={e => onFiltroEstado(e.target.value as typeof filtroEstado)} className={selectFiltroClass}>
          <option value="todos">Todos los estados</option>
          <option value="bruto">En bruto / pendiente</option>
          <option value="pendiente">Pendiente por facturar</option>
          <option value="facturado">Facturado</option>
        </select>

        {filtroActivo && (
          <button
            type="button"
            onClick={() => { onFiltroTipo('todos'); onFiltroEstado('todos'); }}
            className="text-xs text-text-muted hover:text-text-primary underline"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold text-text-secondary">Por recepcionar (completar)</h2>
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
            <PackageOpen size={16} className="text-amber-700" />
            <span className="text-xs text-amber-800">Material pendiente por recepcionar</span>
            <span className="text-sm font-bold text-amber-800">{fmt(totalPendiente)} kg</span>
          </div>
        </div>
        <TablaTickets
          filas={filasBruto}
          modo="bruto"
          nombrePorEntidad={nombrePorEntidad}
          fmt={fmt}
          puedeCrear={puedeCrear}
          puedeEliminar={puedeEliminar}
          puedeRecepcionarTraslado={puedeRecepcionarTraslado}
          onCompletar={onCompletar}
          onEliminar={onEliminar}
          onVerDetalle={onVerDetalle}
          onRecepcionarTraslado={onRecepcionarTraslado}
        />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-text-secondary mb-3">Pendientes por facturar / Facturados</h2>
        <TablaTickets
          filas={filasCompletos}
          modo="completo"
          nombrePorEntidad={nombrePorEntidad}
          fmt={fmt}
          puedeCrear={puedeCrear}
          puedeEliminar={puedeEliminar}
          puedeRecepcionarTraslado={puedeRecepcionarTraslado}
          onCompletar={onCompletar}
          onEliminar={onEliminar}
          onVerDetalle={onVerDetalle}
          onRecepcionarTraslado={onRecepcionarTraslado}
        />
      </div>
    </div>
  );
}

function TablaTickets({
  filas,
  modo,
  nombrePorEntidad,
  fmt,
  puedeCrear,
  puedeEliminar,
  puedeRecepcionarTraslado,
  onCompletar,
  onEliminar,
  onVerDetalle,
  onRecepcionarTraslado,
}: {
  filas: FilaListado[];
  modo: 'bruto' | 'completo';
  nombrePorEntidad: Map<string, string>;
  fmt: (n: number) => string;
  puedeCrear: boolean;
  puedeEliminar: boolean;
  puedeRecepcionarTraslado: boolean;
  onCompletar: (t: TicketPesaje) => void;
  onEliminar: (t: TicketPesaje) => void;
  onVerDetalle: (id: string) => void;
  onRecepcionarTraslado: (t: Traslado) => void;
}) {
  const hayAccion = puedeCrear || puedeEliminar || puedeRecepcionarTraslado;

  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden">
      {filas.length === 0 ? (
        <p className="text-center text-text-muted py-10 text-sm">
          {modo === 'bruto' ? 'No hay operaciones pendientes por recepcionar.' : 'Aún no hay operaciones completadas.'}
        </p>
      ) : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-text-muted">
              <th className="px-4 py-2.5 font-medium">N° Control</th>
              <th className="px-4 py-2.5 font-medium">Fecha</th>
              <th className="px-4 py-2.5 font-medium">Tipo</th>
              <th className="px-4 py-2.5 font-medium">Entidad / Almacenes</th>
              <th className="px-4 py-2.5 font-medium">Materiales</th>
              <th className="px-4 py-2.5 font-medium text-right">{modo === 'bruto' ? 'Peso (kg)' : 'Neto (kg)'}</th>
              <th className="px-4 py-2.5 font-medium text-right">Estado</th>
              {hayAccion && <th className="px-4 py-2.5 font-medium text-right">Acción</th>}
            </tr>
          </thead>
          <tbody>
            {filas.map(f =>
              f.kind === 'pesaje' ? (
                <FilaTicketPesaje
                  key={`t-${f.ticket.id}`}
                  t={f.ticket}
                  modo={modo}
                  nombrePorEntidad={nombrePorEntidad}
                  fmt={fmt}
                  puedeCrear={puedeCrear}
                  puedeEliminar={puedeEliminar}
                  hayAccion={hayAccion}
                  onCompletar={onCompletar}
                  onEliminar={onEliminar}
                  onVerDetalle={onVerDetalle}
                />
              ) : (
                <FilaTicketTraslado
                  key={`tr-${f.traslado.id}`}
                  t={f.traslado}
                  fmt={fmt}
                  puedeRecepcionarTraslado={puedeRecepcionarTraslado}
                  hayAccion={hayAccion}
                  onRecepcionarTraslado={onRecepcionarTraslado}
                />
              )
            )}
          </tbody>
        </table></div>
      )}
    </div>
  );
}

function FilaTicketPesaje({
  t,
  modo,
  nombrePorEntidad,
  fmt,
  puedeCrear,
  puedeEliminar,
  hayAccion,
  onCompletar,
  onEliminar,
  onVerDetalle,
}: {
  t: TicketPesaje;
  modo: 'bruto' | 'completo';
  nombrePorEntidad: Map<string, string>;
  fmt: (n: number) => string;
  puedeCrear: boolean;
  puedeEliminar: boolean;
  hayAccion: boolean;
  onCompletar: (t: TicketPesaje) => void;
  onEliminar: (t: TicketPesaje) => void;
  onVerDetalle: (id: string) => void;
}) {
  return (
    <tr
      onClick={modo === 'completo' ? () => onVerDetalle(t.id) : undefined}
      className={`border-b border-border last:border-b-0 ${modo === 'completo' ? 'cursor-pointer hover:bg-surface-alt/60 transition-colors' : ''}`}
    >
      <td className="px-4 py-2.5 font-medium text-text-primary whitespace-nowrap">
        <span
          className={`inline-flex items-center justify-center w-4 h-4 rounded text-[10px] font-bold mr-1.5 ${
            t.tipo === 'compra' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
          }`}
          title={t.tipo === 'compra' ? 'Compra' : 'Venta'}
        >
          {t.tipo === 'compra' ? 'C' : 'V'}
        </span>
        {t.codigo}
      </td>
      <td className="px-4 py-2.5 text-text-secondary whitespace-nowrap">{t.fecha ?? '—'}</td>
      <td className="px-4 py-2.5 text-text-secondary capitalize">{t.tipo}</td>
      <td className="px-4 py-2.5 text-text-primary">{t.entidadId ? (nombrePorEntidad.get(t.entidadId) ?? '—') : '—'}</td>
      <td className="px-4 py-2.5 text-text-secondary">{resumenMateriales(t)}</td>
      <td className="px-4 py-2.5 text-right font-medium text-text-primary">{fmt(modo === 'bruto' ? t.pesoGlobal : t.pesoNetoTotal)}</td>
      <td className="px-4 py-2.5 text-right">
        {t.estado === 'bruto' ? (
          <span className="px-2 py-0.5 rounded-full text-xs bg-orange-100 text-orange-700">En bruto</span>
        ) : (
          <span className={`px-2 py-0.5 rounded-full text-xs ${t.facturado ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
            {t.facturado ? 'Facturado' : 'Pendiente'}
          </span>
        )}
      </td>
      {hayAccion && (
        <td className="px-4 py-2.5 text-right">
          <div className="flex items-center justify-end gap-3">
            {puedeCrear && t.estado === 'bruto' && (
              <button type="button" onClick={e => { e.stopPropagation(); onCompletar(t); }} className="text-xs font-medium text-brand-600 hover:text-brand-700">
                Completar
              </button>
            )}
            {puedeEliminar && !t.facturado && (
              <button type="button" onClick={e => { e.stopPropagation(); onEliminar(t); }} className="text-text-muted hover:text-red-600 transition-colors" title="Eliminar ticket">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}

/** Fila de traslado dentro de la misma tabla de tickets — mismo layout de
 *  columnas, con "Entidad" leído como "Origen → Destino" y sin acciones de
 *  factura (los traslados no se facturan, no tienen borrado). */
function FilaTicketTraslado({
  t,
  fmt,
  puedeRecepcionarTraslado,
  hayAccion,
  onRecepcionarTraslado,
}: {
  t: Traslado;
  fmt: (n: number) => string;
  puedeRecepcionarTraslado: boolean;
  hayAccion: boolean;
  onRecepcionarTraslado: (t: Traslado) => void;
}) {
  const pendiente = t.estado === 'pendiente';
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-4 py-2.5 font-medium text-text-primary whitespace-nowrap">
        <span
          className="inline-flex items-center justify-center w-4 h-4 rounded text-[10px] font-bold mr-1.5 bg-teal-100 text-teal-700"
          title="Traslado"
        >
          T
        </span>
        {t.codigo}
      </td>
      <td className="px-4 py-2.5 text-text-secondary whitespace-nowrap">{t.createdAt.slice(0, 10)}</td>
      <td className="px-4 py-2.5 text-text-secondary">Traslado</td>
      <td className="px-4 py-2.5 text-text-primary">
        {t.nombreAlmacenOrigen ?? '—'} → {t.nombreAlmacenDestino ?? '—'}
      </td>
      <td className="px-4 py-2.5 text-text-secondary">{resumenMaterialesTraslado(t)}</td>
      <td className="px-4 py-2.5 text-right font-medium text-text-primary">
        {fmt(pendiente ? t.pesoNetoEnviado : (t.pesoNetoRecibido ?? t.pesoNetoEnviado))}
      </td>
      <td className="px-4 py-2.5 text-right">
        <span className={`px-2 py-0.5 rounded-full text-xs ${pendiente ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
          {pendiente ? 'Pendiente' : 'Completo'}
        </span>
      </td>
      {hayAccion && (
        <td className="px-4 py-2.5 text-right">
          {puedeRecepcionarTraslado && pendiente && (
            <button type="button" onClick={() => onRecepcionarTraslado(t)} className="text-xs font-medium text-brand-600 hover:text-brand-700">
              Recepcionar
            </button>
          )}
        </td>
      )}
    </tr>
  );
}

/** Resumen de los materiales de un ticket: nombre si es uno, "N materiales" si varios. */
function resumenMateriales(t: TicketPesaje): string {
  if (t.materiales.length === 0) return '—';
  if (t.materiales.length === 1) return t.materiales[0].nombreProducto ?? 'material';
  return `${t.materiales.length} materiales`;
}

function resumenMaterialesTraslado(t: Traslado): string {
  if (t.materiales.length === 0) return '—';
  if (t.materiales.length === 1) return t.materiales[0].nombreProducto ?? 'material';
  return `${t.materiales.length} materiales`;
}

export default PesajePage;
