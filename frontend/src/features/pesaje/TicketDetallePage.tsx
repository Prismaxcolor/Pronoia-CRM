import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Printer, FileDown, Pencil, Loader2, Plus, Trash2, Scale, ChevronDown } from 'lucide-react';
import { BotonAccion, EncabezadoPagina, EstadoVacio, SkeletonBloque, SkeletonKpis, formatearFecha } from '../../components/ui';
import TicketVista, { InsigniasTicket, type FotoGaleria } from './ticket-vista';
import { CabeceraImpresion, CuerpoImpresion } from './ticket-impresion';
import { obtenerTicket, editarTicket, type AvisoFacturaTicket } from '../../services/ticket-pesaje-service';
import AvisoFacturaBanner from './AvisoFacturaBanner';
import { obtenerProductos } from '../../services/producto-service';
import { obtenerLotes } from '../../services/lote-service';
import { obtenerTaras } from '../../services/tara-service';
import { obtenerVehiculos } from '../../services/vehiculo-service';
import VehiculoSelector from '../../components/VehiculoSelector';
import { buscarVehiculoPorTexto } from '../../lib/vehiculo';
import { obtenerProveedores } from '../../services/proveedor-service';
import { obtenerClientes } from '../../services/cliente-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { useBorradorPersistente } from '../../hooks/use-borrador-persistente';
import AvisoBorrador from '../../components/AvisoBorrador';
import { difiereEstado, huellaDocumento } from '../../lib/borrador';
import { mensajeReseteos, mensajeSaneoBorrador, sanearFilasRestauradas } from '../../lib/borrador-vigentes';
import { filaVacia, filasDesdeBorrador, taraFilaNoVigente, MENSAJE_TARA_NO_VIGENTE, taraKgFila, netoFila, subirFotosFila, materialAPayload, esFilaSinLote, loteIdsPosiblesFila, seleccionarTaraFila, type MaterialFila, type FotoMaterial } from './material-fila';
import { diferenciaFavoreceProveedor, colorClaseDiferencia, calcularDiferenciaPeso, redondearKg, descripcionDiferencia } from './diferencia-peso';
import FotoMaterialPicker from './FotoMaterialPicker';
import SeleccionarMaterialModal from './SeleccionarMaterialModal';
import SelectorDestinoLote from './SelectorDestinoLote';
import SeleccionarTaraModal from './SeleccionarTaraModal';
import { type Producto, type TicketPesaje, type Lote, type Tara, type Vehiculo } from '@shared/types/index.js';
import { descargarTicketPDF } from '../../services/ticket-export';
import HistorialEdiciones from '../../components/HistorialEdiciones';
import GenerarLlaveEdicion from '../../components/GenerarLlaveEdicion';
import { obtenerConfigLlaves } from '../../services/llave-service';
import CompartirBoton from '../../components/CompartirBoton';
import PesajesGlobalesEditor from './PesajesGlobalesEditor';
import { pesajeGlobalVacio, sumaPesajesGlobales, subirFotosPesajeGlobal, type PesajeGlobalFila } from './pesaje-global-fila';
import VisorFotos from '../../components/VisorFotos';
import { etiquetaPesadaGlobal, pesadasGlobalesConUnidos, tituloTicket } from '../../lib/ticket-documento';

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
    guardado: m.productoId ? { productoId: m.productoId, destinoTipo: m.destinoTipo } : undefined,
    fotos: m.fotos.map(url => ({ tipo: 'existente' as const, url })),
  }));
}

/** Campos del formulario de edición de un ticket, a partir del ticket guardado. */
function estadoEdicionDesdeTicket(t: TicketPesaje) {
  return {
    materiales: filasDesdeTicket(t),
    devolucionEdit: t.devolucion ? String(t.devolucion) : '',
    fotosDevolucionEdit: t.fotosDevolucion.map(url => ({ tipo: 'existente' as const, url })) as FotoMaterial[],
    observacionesEdit: t.observaciones ?? '',
    vehiculoEdit: t.vehiculo ?? '',
    fechaEdit: t.fecha ?? t.createdAt.slice(0, 10),
    pesajesEdit: t.pesajesGlobales.map(p => ({
      ...pesajeGlobalVacio(),
      peso: String(p.peso),
      tara: p.tara ? String(p.tara) : '',
      fotos: p.fotos.map(url => ({ tipo: 'existente' as const, url })),
    })) as PesajeGlobalFila[],
    pesajesTocados: false,
  };
}

/** El contenido va con `key` = id: al pasar de un ticket a otro todo el estado (edición, borrador,
 *  catálogos) se reinicia, y el estado de un ticket jamás se guarda bajo la clave de otro. */
function TicketDetallePage() {
  const { id = '' } = useParams();
  return <TicketDetalleContenido key={id} />;
}

function TicketDetalleContenido() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { tienePermiso, usuario } = useAuth();
  const toast = useToast();
  const esSuperadmin = usuario?.rol === 'superadmin';
  // El servidor exige llave a todo no-superadmin (activa por defecto; solo REQUIRE_EDIT_KEY=false la apaga).
  const [requiereLlave, setRequiereLlave] = useState(true);
  const [llaveEdicion, setLlaveEdicion] = useState('');

  const puedeEditar = tienePermiso('pesaje', 'editar');

  const [ticket, setTicket] = useState<TicketPesaje | null>(null);
  const [cargando, setCargando] = useState(true);
  const [nombrePorEntidad, setNombrePorEntidad] = useState<Map<string, string>>(new Map());
  const [productos, setProductos] = useState<Producto[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [taras, setTaras] = useState<Tara[]>([]);
  // Catálogo completo (incluye inactivos): el detalle muestra la foto aunque el vehículo ya se haya desactivado.
  const [catalogoVehiculos, setCatalogoVehiculos] = useState<Vehiculo[]>([]);

  const [editando, setEditando] = useState(false);
  const [avisosFactura, setAvisosFactura] = useState<AvisoFacturaTicket[]>([]);
  const [materiales, setMateriales] = useState<MaterialFila[]>([filaVacia()]);
  const [devolucionEdit, setDevolucionEdit] = useState('');
  const [fotosDevolucionEdit, setFotosDevolucionEdit] = useState<FotoMaterial[]>([]);
  const [observacionesEdit, setObservacionesEdit] = useState('');
  const [vehiculoEdit, setVehiculoEdit] = useState('');
  const [fechaEdit, setFechaEdit] = useState('');
  const [pesajesEdit, setPesajesEdit] = useState<PesajeGlobalFila[]>([]);
  // Solo se envían las pesadas si el usuario las tocó (tickets viejos pueden no tener desglose ni fotos por pesada).
  const [pesajesTocados, setPesajesTocados] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocultarDestino, setOcultarDestino] = useState(false);
  const [fotoAmpliada, setFotoAmpliada] = useState<{ url: string; label: string; peso: number | null } | null>(null);
  const [filaActivaUid, setFilaActivaUid] = useState<number | null>(null);
  const [mostrarSelectorMaterial, setMostrarSelectorMaterial] = useState(false);
  const [mostrarSelectorTara, setMostrarSelectorTara] = useState(false);
  const [catalogosListos, setCatalogosListos] = useState(false);
  const [avisoSaneo, setAvisoSaneo] = useState<string | null>(null);

  const cargarTicket = () => {
    obtenerTicket(id).then(t => { setTicket(t); setCargando(false); });
  };

  useEffect(() => {
    cargarTicket();
    obtenerConfigLlaves().then(cfg => setRequiereLlave(cfg.requiereLlave));
    Promise.all([obtenerProveedores(), obtenerClientes()]).then(([proveedores, clientes]) => {
      const m = new Map<string, string>();
      [...proveedores, ...clientes].forEach(e => m.set(e.id, e.nombre));
      setNombrePorEntidad(m);
    });
    const productosP = obtenerProductos().then(lista => { setProductos(lista.filter(p => p.activo)); });
    const lotesP = obtenerLotes().then(lista => { setLotes(lista.filter(l => l.activo)); });
    const tarasP = obtenerTaras().then(lista => { setTaras(lista.filter(t => t.activo)); });
    // Sin catálogos cargados no se puede validar un borrador restaurado.
    Promise.all([productosP, lotesP, tarasP]).then(() => setCatalogosListos(true), () => { /* sin catálogos no se restaura */ });
    obtenerVehiculos().then(setCatalogoVehiculos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const pesoNetoTotal = useMemo(
    () => redondearKg(materiales.reduce((acc, f) => acc + netoFila(f, taras), 0)),
    [materiales, taras]
  );
  const pesoGlobalEdit = pesajesTocados ? sumaPesajesGlobales(pesajesEdit) : (ticket?.pesoGlobal ?? 0);
  const diferencia = useMemo(
    () => calcularDiferenciaPeso({ pesoGlobal: pesoGlobalEdit, netoMateriales: pesoNetoTotal, devolucion: Number(devolucionEdit) || 0 }),
    [pesoGlobalEdit, pesoNetoTotal, devolucionEdit]
  );

  /** Subtotal por material cuando el mismo material se pesó más de una vez
   *  en este ticket (varias pesadas) — para no repetir el total a simple
   *  vista sumando filas sueltas. */
  const totalesPorMaterial = useMemo(() => {
    if (!ticket) return [];
    const mapa = new Map<string, { nombre: string; total: number; cantidad: number }>();
    for (const m of ticket.materiales) {
      const clave = m.productoId ?? m.id;
      const existente = mapa.get(clave);
      if (existente) {
        existente.total += m.pesoNeto;
        existente.cantidad += 1;
      } else {
        mapa.set(clave, { nombre: m.nombreProducto ?? '—', total: m.pesoNeto, cantidad: 1 });
      }
    }
    return Array.from(mapa.values()).filter(t => t.cantidad > 1);
  }, [ticket]);

  const iniciarEdicion = () => {
    if (!ticket) return;
    aplicarEstadoEdicion(estadoEdicionDesdeTicket(ticket));
    setError(null);
    setEditando(true);
  };

  const aplicarEstadoEdicion = (e: ReturnType<typeof estadoEdicionDesdeTicket>) => {
    setMateriales(e.materiales);
    setDevolucionEdit(e.devolucionEdit);
    setFotosDevolucionEdit(e.fotosDevolucionEdit);
    setObservacionesEdit(e.observacionesEdit);
    setVehiculoEdit(e.vehiculoEdit);
    setFechaEdit(e.fechaEdit);
    setPesajesEdit(e.pesajesEdit);
    setPesajesTocados(e.pesajesTocados);
  };

  // Borrador de la edición: sobrevive a F5 (el ticket se recarga y se reabre la edición). La llave
  // de edición nunca forma parte del borrador.
  const estadoEdicion = { materiales, devolucionEdit, fotosDevolucionEdit, observacionesEdit, vehiculoEdit, fechaEdit, pesajesEdit, pesajesTocados };
  // Solo se guarda/restaura un borrador del ticket que está cargado (nunca el de otro id), si el
  // usuario puede editarlo (permiso o llave, estado, ticket no unido) y con los catálogos listos.
  const ticketCargado = ticket && ticket.id === id ? ticket : null;
  const puedeEditarEsteTicket = !!ticketCargado
    && (puedeEditar || (requiereLlave && !esSuperadmin))
    && ticketCargado.estado !== 'bruto'
    && !ticketCargado.ticketPrincipalId;
  // Huella del ticket cargado: si cambió desde que se guardó el borrador, este se descarta con aviso.
  const huellaTicket = useMemo(() => (ticketCargado ? huellaDocumento(ticketCargado) : null), [ticketCargado]);
  const borrador = useBorradorPersistente<typeof estadoEdicion>({
    formulario: 'ticket-edicion',
    docId: id,
    version: 1,
    habilitado: puedeEditarEsteTicket && catalogosListos,
    huellaBase: huellaTicket,
    estado: estadoEdicion,
    hayCambios: editando && !!ticket && difiereEstado(estadoEdicion, estadoEdicionDesdeTicket(ticket)),
    aplicar: d => {
      // Material, lote o tara que ya no existen (o se desactivaron) quedan sin elegir, con aviso.
      const saneo = sanearFilasRestauradas(filasDesdeBorrador(d.materiales), {
        productoIds: productos.map(p => p.id),
        loteIds: lotes.map(l => l.id),
        taraIds: taras.map(t => t.id),
      });
      const texto = mensajeReseteos(saneo.reseteos);
      setAvisoSaneo(texto ? mensajeSaneoBorrador([texto]) : null);
      aplicarEstadoEdicion({
        materiales: saneo.filas,
        devolucionEdit: d.devolucionEdit ?? '',
        fotosDevolucionEdit: d.fotosDevolucionEdit ?? [],
        observacionesEdit: d.observacionesEdit ?? '',
        vehiculoEdit: d.vehiculoEdit ?? '',
        fechaEdit: d.fechaEdit ?? '',
        pesajesEdit: (d.pesajesEdit ?? []).map(f => ({ ...f, uid: pesajeGlobalVacio().uid, fotos: f.fotos ?? [] })),
        pesajesTocados: !!d.pesajesTocados,
      });
      setEditando(true);
    },
    restablecer: () => { setEditando(false); setAvisoSaneo(null); },
  });

  const cancelarEdicion = () => { borrador.limpiar(); setAvisoSaneo(null); setEditando(false); };

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

  /** Sube las fotos nuevas de cada pesaje; null si alguna falla o un pesaje queda sin foto. */
  const pesajesParaEnviar = async () => {
    const salida = [];
    for (const f of pesajesEdit) {
      const fotos = await subirFotosPesajeGlobal(f);
      if (!fotos || fotos.length === 0) return null;
      salida.push({ peso: Number(f.peso) || 0, tara: Number(f.tara) || 0, fotos });
    }
    return salida;
  };

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
    if (materiales.some(f => taraFilaNoVigente(f, taras))) { setError(MENSAJE_TARA_NO_VIGENTE); return; }
    if (materiales.some(f => netoFila(f, taras) <= 0)) { setError('Cada material debe tener un peso neto mayor a 0.'); return; }
    if (materiales.some(f => f.fotos.length === 0)) { setError('Cada material necesita al menos una foto.'); return; }
    if (Number(devolucionEdit) > 0 && fotosDevolucionEdit.length === 0) { setError('Agrega al menos una foto de la devolución.'); return; }
    if (diferenciaFavoreceProveedor(diferencia, ticket.pesajeExterior)) {
      setError('La suma de materiales + devolución supera el peso global — eso favorece al proveedor. Revisa los pesos antes de guardar.');
      return;
    }

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

    const pesajesPayload = pesajesTocados ? await pesajesParaEnviar() : undefined;
    if (pesajesTocados && !pesajesPayload) {
      setError('No se pudo subir una foto del pesaje global, o falta una foto en algún pesaje.');
      setGuardando(false);
      return;
    }

    const result = await editarTicket(ticket.id, {
      observaciones: observacionesEdit.trim() || null,
      vehiculo: vehiculoEdit.trim() || null,
      devolucion: Number(devolucionEdit) || 0,
      fotosDevolucion: urlsDevolucion,
      materiales: materialesConFotos,
      fecha: fechaEdit || undefined,
      pesajesGlobales: pesajesPayload ?? undefined,
      llaveEdicion: requiereLlave && llaveEdicion.trim() ? llaveEdicion.trim() : undefined,
    });
    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    toast.exito(`${result.ticket.codigo} actualizado.`);
    if (result.advertencia) toast.errorMsg(result.advertencia);
    setAvisosFactura(result.avisosFactura ?? []);
    setLlaveEdicion('');
    borrador.limpiar();
    setEditando(false);
    cargarTicket();
  };

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  if (cargando) {
    return (
      <div className="max-w-5xl" aria-busy="true">
        <EncabezadoPagina titulo="Ticket de pesaje" subtitulo="Cargando el documento…" migas={[{ etiqueta: 'Pesaje', to: '/pesaje' }, { etiqueta: 'Ticket' }]} />
        <SkeletonKpis />
        <SkeletonBloque alto="h-56" conMargen etiqueta="Cargando materiales" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="max-w-5xl">
        <EncabezadoPagina titulo="Ticket de pesaje" migas={[{ etiqueta: 'Pesaje', to: '/pesaje' }, { etiqueta: 'No encontrado' }]} />
        <EstadoVacio
          mensaje="No se encontró el ticket."
          descripcion="Puede que se haya eliminado o que el enlace no sea correcto."
          accion={{ etiqueta: 'Volver a Pesaje', to: '/pesaje' }}
        />
      </div>
    );
  }

  const esCompra = ticket.tipo === 'compra';
  const vehiculosActivos = catalogoVehiculos.filter(v => v.activo);
  const vehiculoDelCatalogo = buscarVehiculoPorTexto(ticket.vehiculo, catalogoVehiculos);
  // (puedeEditarEsteTicket, definido arriba: con llave se edita aunque el rol no tenga
  // 'pesaje:editar' y aunque el ticket esté facturado.)

  // Todas las fotos del ticket (por material + generales) en una sola galería
  // con etiqueta de material, en vez de un bloque apilado por material
  // (se veía como una lista infinita de fotos, una por fila).
  const fotosGaleria: FotoGaleria[] = [
    ...ticket.materiales.flatMap(m =>
      m.fotos.map((url, i) => ({ key: `m-${m.id}-${i}`, url, label: m.nombreProducto ?? 'Material', peso: m.pesoNeto as number | null }))
    ),
    ...pesadasGlobalesConUnidos(ticket).flatMap(({ pesada: p, codigo, indice, total }) =>
      p.fotos.map((url, i) => ({
        key: `p-${p.id}-${i}`,
        url,
        label: etiquetaPesadaGlobal((ticket.pesajesGlobalesUnidos ?? []).length > 0, codigo, indice, total),
        peso: (p.peso - p.tara) as number | null,
      }))
    ),
    ...ticket.fotosDevolucion.map((url, i) => ({ key: `d-${i}`, url, label: 'Devolución', peso: null as number | null })),
    ...(ticket.fotos ?? []).map((url, i) => ({ key: `g-${i}`, url, label: 'General', peso: null as number | null })),
  ];

  const nombreEntidad = ticket.entidadId ? (nombrePorEntidad.get(ticket.entidadId) ?? '—') : '—';
  const descargarPdf = (formato?: 'blob') => descargarTicketPDF(ticket, nombreEntidad, esCompra, formato);

  return (
    <div className="max-w-5xl print-documento print:max-w-none">
      <AvisoFacturaBanner avisos={avisosFactura} onIrEstadoCuenta={ruta => navigate(ruta)} onCerrar={() => setAvisosFactura([])} />

      {/* Cabecera de pantalla (la hoja impresa usa CabeceraImpresion, con el logo y el marcado de siempre). */}
      <div className="print:hidden">
        <EncabezadoPagina
          titulo={tituloTicket(ticket.estado)}
          subtitulo={`${ticket.codigo} · ${esCompra ? 'Proveedor' : 'Cliente'}: ${nombreEntidad} · ${formatearFecha(ticket.fecha ?? ticket.createdAt.slice(0, 10))}`}
          migas={[{ etiqueta: 'Pesaje', to: '/pesaje' }, { etiqueta: ticket.codigo }]}
          acciones={!editando && (
            <>
              {esSuperadmin && puedeEditarEsteTicket && (
                <GenerarLlaveEdicion entidadTipo="ticket_pesaje" entidadId={ticket.id} />
              )}
              {puedeEditarEsteTicket && (
                <BotonAccion icono={<Pencil size={16} />} onClick={iniciarEdicion}>Editar</BotonAccion>
              )}
              <BotonAccion variante="secundario" icono={<FileDown size={16} />} onClick={() => descargarPdf()}>PDF</BotonAccion>
              <BotonAccion variante="secundario" icono={<Printer size={16} />} onClick={() => window.print()}>Imprimir</BotonAccion>
              <CompartirBoton titulo={`Ticket de pesaje ${ticket.codigo}`} obtenerPdf={() => descargarPdf('blob')} />
            </>
          )}
        />
        <InsigniasTicket ticket={ticket} />
      </div>
      <CabeceraImpresion ticket={ticket} />

      {!editando ? (
        <>
          <TicketVista
            ticket={ticket}
            fotos={fotosGaleria}
            vehiculoDelCatalogo={vehiculoDelCatalogo}
            ocultarDestino={ocultarDestino}
            onOcultarDestino={setOcultarDestino}
            totalesPorMaterial={totalesPorMaterial}
            onAbrirFoto={setFotoAmpliada}
            onEditar={puedeEditarEsteTicket ? iniciarEdicion : undefined}
          />
          <CuerpoImpresion ticket={ticket} nombreEntidad={nombreEntidad} ocultarDestino={ocultarDestino} totalesPorMaterial={totalesPorMaterial} />

          <HistorialEdiciones entidadTipo="ticket_pesaje" entidadId={ticket.id} />
        </>
      ) : (
        <form onSubmit={guardarEdicion} className="max-w-2xl bg-surface rounded-xl border border-border p-5 space-y-4">
          <AvisoBorrador formulario="la edición de este ticket" aviso={borrador.aviso} onDescartar={borrador.descartar} onCerrar={borrador.cerrarAviso} />
          {avisoSaneo && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">{avisoSaneo}</p>}
          {ticket.facturado && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
              Este ticket ya está facturado. Al guardar con la llave de edición, la factura se anula si aún no tiene pagos (el ticket queda disponible para volver a facturar con los datos corregidos). Si ya fue pagada, no se anula: te avisaremos para que revises el estado de cuenta.
            </p>
          )}

          <div>
            <label className={labelClass}>Fecha</label>
            <input type="date" value={fechaEdit} onChange={e => setFechaEdit(e.target.value)} className={inputClass} required />
          </div>

          {ticket.pesajeExterior ? (
            <p className="text-xs text-text-muted bg-surface-alt border border-border rounded-lg px-4 py-2.5">
              Sin pesaje global — no hay peso global para reconciliar.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between text-sm bg-surface-alt border border-border rounded-lg px-4 py-2.5">
                <span className="text-text-secondary">Peso global</span>
                <span className="font-semibold text-text-primary">{fmt(pesajesTocados ? sumaPesajesGlobales(pesajesEdit) : ticket.pesoGlobal)} kg</span>
              </div>
              <PesajesGlobalesEditor
                pesajes={pesajesEdit}
                onChange={siguiente => { setPesajesEdit(siguiente); setPesajesTocados(true); }}
              />
            </>
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

                  {esFilaSinLote(f, productos) ? (
                    <p className="text-xs text-text-muted bg-surface-alt border border-border rounded-lg px-3 py-2">
                      "{productos.find(p => p.id === f.productoId)?.tipoMaterialNombre}" es una categoría sin lote — este material va directo a inventario general, no pide lote.
                    </p>
                  ) : (
                    <div>
                      <label className={labelClass}>Destino (inventario) *</label>
                      <SelectorDestinoLote lotes={lotes} loteIdsPosibles={loteIdsPosiblesFila(f, productos)} valor={f.destino} onChange={id => setFila(f.uid, 'destino', id)} />
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
                            <button
                              type="button"
                              onClick={() => { setFilaActivaUid(f.uid); setMostrarSelectorTara(true); }}
                              className={`${inputClass} flex items-center justify-between gap-2 text-left`}
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
                <span className={`font-semibold ${colorClaseDiferencia(diferencia, pesoGlobalEdit, ticket?.pesajeExterior ?? false)}`}>{fmt(diferencia)} kg<span className="ml-1 font-normal text-xs text-brand-700">({descripcionDiferencia(diferencia)})</span></span>
              </div>
            )}
          </div>

          <VehiculoSelector value={vehiculoEdit} onChange={setVehiculoEdit} vehiculos={vehiculosActivos} inputClass={inputClass} labelClass={labelClass} />

          <div>
            <label className={labelClass}>Observaciones</label>
            <textarea value={observacionesEdit} onChange={e => setObservacionesEdit(e.target.value)} className={`${inputClass} resize-none`} rows={2} placeholder="Notas del pesaje" />
          </div>

          {requiereLlave && !esSuperadmin && (
            <div>
              <label className={labelClass}>Llave de edición</label>
              <input
                type="text"
                value={llaveEdicion}
                onChange={e => setLlaveEdicion(e.target.value)}
                className={`${inputClass} font-mono uppercase tracking-wider`}
                placeholder="Código entregado por el administrador"
                autoComplete="off"
                required
              />
            </div>
          )}

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
        <VisorFotos
          fotos={fotosGaleria.map(f => f.url)}
          indice={Math.max(0, fotosGaleria.findIndex(f => f.url === fotoAmpliada.url))}
          onCambiar={i => setFotoAmpliada(fotosGaleria[i])}
          onCerrar={() => setFotoAmpliada(null)}
          pie={<>{fotoAmpliada.label}{fotoAmpliada.peso != null && ` — ${fmt(fotoAmpliada.peso)} kg`}</>}
        />
      )}

      {mostrarSelectorMaterial && (
        <SeleccionarMaterialModal
          productos={productos}
          onClose={() => setMostrarSelectorMaterial(false)}
          onSeleccionar={id => {
            if (filaActivaUid != null) setFila(filaActivaUid, 'productoId', id);
            setMostrarSelectorMaterial(false);
          }}
        />
      )}
      {mostrarSelectorTara && (
        <SeleccionarTaraModal
          taras={taras}
          taraSeleccionada={materiales.find(f => f.uid === filaActivaUid)?.taraId || undefined}
          onClose={() => setMostrarSelectorTara(false)}
          onSeleccionar={taraId => {
            if (filaActivaUid != null) {
              setMateriales(prev => prev.map(x => (x.uid === filaActivaUid ? { ...x, ...seleccionarTaraFila(x, taraId) } : x)));
            }
            setMostrarSelectorTara(false);
          }}
        />
      )}
    </div>
  );
}

export default TicketDetallePage;
