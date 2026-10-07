import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Scale, Loader2, Plus, Trash2, ChevronDown, AlertTriangle } from 'lucide-react';
import { obtenerProveedores } from '../../services/proveedor-service';
import { obtenerClientes } from '../../services/cliente-service';
import { obtenerProductos } from '../../services/producto-service';
import { obtenerTickets, crearTicket, borrarTicket } from '../../services/ticket-pesaje-service';
import { obtenerLotes } from '../../services/lote-service';
import { obtenerTaras } from '../../services/tara-service';
import { obtenerAlmacenes, obtenerStockAlmacen, obtenerStockGlobal } from '../../services/almacen-service';
import { crearTraslado, obtenerTraslados } from '../../services/traslado-service';
import { obtenerTomasFisicas } from '../../services/toma-fisica-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { useConfirm } from '../../hooks/use-confirm-context';
import { usePesajeBorrador } from '../../hooks/use-pesaje-borrador-context';
import { usePestanaRecordada } from '../../hooks/use-pestana-recordada';
import CompletarTicketModal from './CompletarTicketModal';
import CompletarTrasladoModal from '../inventario/CompletarTrasladoModal';
import SeleccionarMaterialModal from './SeleccionarMaterialModal';
import SeleccionarTaraModal from './SeleccionarTaraModal';
import CantidadTaraInput from './CantidadTaraInput';
import SeleccionarEntidadModal from '../../components/SeleccionarEntidadModal';
import FotoMaterialPicker from './FotoMaterialPicker';
import TicketsBrutoProveedor from './TicketsBrutoProveedor';
import { faltantesParaAgregar, productoRequiereLote, ticketsBrutoDeEntidad } from './pesaje-nuevo-logica';
import { AlertaItem, EncabezadoPagina, Pestanas } from '../../components/ui';
import TicketsSeccion from './lista-TicketsSeccion';
import { CLAVES_FILTROS_PESAJE } from '../../lib/pesaje-lista';
import { idVigenteOVacio, mensajeReseteos, mensajeSaneoBorrador, sanearFilasRestauradas } from '../../lib/borrador-vigentes';
import TarasExtraEditor from './TarasExtraEditor';
import { filaTaraIncompleta } from './tara-multiple';
import { filaVacia, taraKgFila, taraFilaNoVigente, MENSAJE_TARA_NO_VIGENTE, netoFila, subirFotosFila, materialAPayload, esFilaSinLote, loteIdsPosiblesFila, seleccionarTaraFila, type MaterialFila } from './material-fila';
import { obtenerVehiculos } from '../../services/vehiculo-service';
import VehiculoSelector from '../../components/VehiculoSelector';
import { loteTrasladoFilaVacia, netoLoteTrasladoFila } from './lote-traslado-fila';
import AvisoBorrador from '../../components/AvisoBorrador';
import { pesajeGlobalVacio, netoPesajeGlobalFila, sumaPesajesGlobales, subirFotosPesajeGlobal } from './pesaje-global-fila';
import { diferenciaFavoreceProveedor, colorClaseDiferencia, calcularDiferenciaPeso, redondearKg, descripcionDiferencia } from './diferencia-peso';
import { lotesSeleccionables } from '@shared/types/lote.js';
import { type Producto, type TicketPesaje, type Lote, type Tara, type Almacen, type Traslado, type TomaFisicaInventario, type Vehiculo } from '@shared/types/index.js';

interface Entidad { id: string; nombre: string; activo: boolean; fotos?: string[] }

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
  const puedeContarTomaFisica = tienePermiso('toma_fisica', 'ver');

  // Si no tiene permiso para ver Tickets, "tickets" queda fuera de los valores
  // válidos — ignora cualquier pestaña "tickets" guardada de una sesión
  // anterior (ej. downgrade de rol); si no, el switch de pestañas queda oculto
  // pero el contenido también, y la página se ve en blanco.
  const [pestana, setPestana] = usePestanaRecordada<Pestana>(
    'pronoia:pesaje:pestana',
    puedeVerTickets ? ['nuevo', 'tickets'] : ['nuevo'],
    'nuevo',
  );
  // Un enlace directo con filtros de la lista (p. ej. /pesaje?estado=bruto) abre la pestaña Tickets.
  const [paramsUrl] = useSearchParams();
  const urlApuntaALaLista = CLAVES_FILTROS_PESAJE.some(k => paramsUrl.has(k));
  useEffect(() => {
    if (urlApuntaALaLista && puedeVerTickets && pestana !== 'tickets') setPestana('tickets');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al entrar a la pantalla.
  }, []);
  const [proveedores, setProveedores] = useState<Entidad[]>([]);
  const [clientes, setClientes] = useState<Entidad[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [taras, setTaras] = useState<Tara[]>([]);
  const [tickets, setTickets] = useState<TicketPesaje[]>([]);
  const [traslados, setTraslados] = useState<Traslado[]>([]);
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [catalogosListos, setCatalogosListos] = useState(false);
  const [almacenesListos, setAlmacenesListos] = useState(false);
  const [stockOrigen, setStockOrigen] = useState<Map<string, number>>(new Map());
  const [stockGlobalDisponible, setStockGlobalDisponible] = useState<Map<string, number>>(new Map());
  const [tomasFisicasAbiertas, setTomasFisicasAbiertas] = useState<TomaFisicaInventario[]>([]);

  // Campos del formulario "Nuevo pesaje" — viven en un Provider por encima de
  // las rutas (usePesajeBorrador), no en useState local, para no perderse si
  // el usuario navega a otra pantalla (Dashboard, Cochinito, etc.) y vuelve.
  const {
    borrador: { tipo, entidadId, almacenOrigenId, almacenDestinoId, fecha, pesajesGlobales, pesajeExterior, devolucion, fotosDevolucion, materiales, observaciones, vehiculo, loteFilas },
    setLoteFilas, avisoRestauracion, descartarBorradorRestaurado, cerrarAvisoRestauracion,
    saneoPendiente, avisoSaneo, finalizarSaneo,
    setTipo, setEntidadId, setAlmacenOrigenId, setAlmacenDestinoId, setFecha,
    setPesajesGlobales, setPesajeExterior, setDevolucion, setFotosDevolucion, setMateriales, setObservaciones, setVehiculo,
    limpiarBorrador,
  } = usePesajeBorrador();

  // En compra y venta el pesaje global es obligatorio, salvo que se active
  // explícitamente "Peso exterior / sin pesaje global". Traslado no aplica.
  // El "peso exterior" solo existe en compra: en venta el pesaje global siempre es obligatorio.
  const sinPesajeGlobal = tipo === 'compra' && pesajeExterior;

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticketACompletar, setTicketACompletar] = useState<TicketPesaje | null>(null);
  const [trasladoARecepcionar, setTrasladoARecepcionar] = useState<Traslado | null>(null);
  const [filaActivaUid, setFilaActivaUid] = useState<number | null>(null);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [mostrarSelectorMaterial, setMostrarSelectorMaterial] = useState(false);
  const [mostrarSelectorTara, setMostrarSelectorTara] = useState(false);
  const [mostrarSelectorEntidad, setMostrarSelectorEntidad] = useState(false);
  const [mostrarSelectorLote, setMostrarSelectorLote] = useState(false);
  const [filaLoteActivaUid, setFilaLoteActivaUid] = useState<number | null>(null);
  // Lotes posibles (anclados) del material de la fila cuyo lote se está eligiendo.
  const lotesPosiblesDeFilaActiva = useMemo(() => {
    const fila = materiales.find(m => m.uid === filaLoteActivaUid);
    return fila ? loteIdsPosiblesFila(fila, productos) : [];
  }, [materiales, filaLoteActivaUid, productos]);
  const filaLoteActiva = materiales.find(m => m.uid === filaLoteActivaUid);
  const lotesSelector = useMemo(
    () => lotesSeleccionables(lotes, lotesPosiblesDeFilaActiva, filaLoteActiva?.destino),
    [lotes, lotesPosiblesDeFilaActiva, filaLoteActiva?.destino]
  );
  const [mostrarSelectorAlmacenOrigen, setMostrarSelectorAlmacenOrigen] = useState(false);
  const [mostrarSelectorAlmacenDestino, setMostrarSelectorAlmacenDestino] = useState(false);

  const [ticketsListos, setTicketsListos] = useState(false);
  const cargarTickets = () => { obtenerTickets().then(lista => { setTickets(lista); setTicketsListos(true); }); };
  const cargarTraslados = () => { obtenerTraslados().then(setTraslados); };

  useEffect(() => {
    const proveedoresP = obtenerProveedores().then(lista => { setProveedores(lista.filter(p => p.activo)); });
    const clientesP = obtenerClientes().then(lista => { setClientes(lista.filter(c => c.activo)); });
    const productosP = obtenerProductos().then(lista => { setProductos(lista.filter(p => p.activo)); });
    const lotesP = obtenerLotes().then(lista => { setLotes(lista.filter(l => l.activo)); });
    const tarasP = obtenerTaras().then(lista => { setTaras(lista.filter(t => t.activo)); });
    // Solo con todos los catálogos cargados se puede validar un borrador restaurado (ver más abajo).
    Promise.all([proveedoresP, clientesP, productosP, lotesP, tarasP]).then(() => setCatalogosListos(true), () => { /* sin catálogos no se valida el borrador */ });
    obtenerVehiculos().then(lista => setVehiculos(lista.filter(v => v.activo)));
    cargarTickets();
    cargarTraslados();
    if (puedeContarTomaFisica) {
      obtenerTomasFisicas().then(lista => setTomasFisicasAbiertas(lista.filter(t => t.estado === 'abierta')));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stock del almacén de origen elegido, para avisar (sin bloquear) si un
  // traslado deja el material en negativo.
  useEffect(() => {
    const promesa = tipo === 'traslado' && almacenOrigenId
      ? obtenerStockAlmacen(almacenOrigenId)
      : Promise.resolve(new Map<string, number>());
    promesa.then(setStockOrigen);
    // Los lotes elegidos se limpian en el setter del borrador cuando cambia
    // el tipo o el almacén de origen (ver use-pesaje-borrador.tsx).
  }, [tipo, almacenOrigenId]);

  // Disponible del negocio (sin importar almacén) para el aviso informativo
  // al vender — nunca bloquea, solo avisa (decisión P-3 del plan de
  // consolidación, docs/PLAN_consolidacion_inventario.md).
  useEffect(() => {
    const promesa = tipo === 'venta' ? obtenerStockGlobal() : Promise.resolve(new Map<string, number>());
    promesa.then(setStockGlobalDisponible);
  }, [tipo]);

  const entidades = tipo === 'compra' ? proveedores : clientes;
  const labelEntidad = tipo === 'compra' ? 'Proveedor' : 'Cliente';
  const almacenPredeterminado = almacenes.find(a => a.esPredeterminado);

  // Recarga la lista de almacenes al cambiar de pestaña de tipo — si la
  // estrella se movió desde otra pantalla, se refleja sin recargar la página.
  useEffect(() => {
    obtenerAlmacenes().then(lista => { setAlmacenes(lista.filter(a => a.activo)); setAlmacenesListos(true); });
  }, [tipo]);

  // Mapa id→nombre de proveedores + clientes (para la tabla de tickets recientes)
  const nombrePorEntidad = useMemo(() => {
    const m = new Map<string, string>();
    [...proveedores, ...clientes].forEach(e => m.set(e.id, e.nombre));
    return m;
  }, [proveedores, clientes]);

  const pesoNetoTotal = useMemo(
    () => redondearKg(materiales.reduce((acc, f) => acc + netoFila(f, taras), 0)),
    [materiales, taras]
  );

  // Diferencia = Peso Global - suma de materiales netos - devolución.
  const diferencia = useMemo(
    () => calcularDiferenciaPeso({ pesoGlobal: sumaPesajesGlobales(pesajesGlobales), netoMateriales: pesoNetoTotal, devolucion: Number(devolucion) || 0 }),
    [pesajesGlobales, pesoNetoTotal, devolucion]
  );

  const setFila = (uid: number, campo: keyof MaterialFila, valor: string) =>
    setMateriales(prev => prev.map(f => (f.uid === uid ? { ...f, [campo]: valor } : f)));

  const faltaParaAgregar = useMemo(() => faltantesParaAgregar(materiales, productos), [materiales, productos]);
  const ticketsBrutoProveedor = useMemo(
    () => (tipo === 'compra' ? ticketsBrutoDeEntidad(tickets, entidadId) : []),
    [tipo, tickets, entidadId]
  );
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
    setFotosDevolucion(prev => [...prev, ...files.map(file => ({ tipo: 'nueva' as const, file, preview: URL.createObjectURL(file) }))]);
  const quitarFotoDevolucion = (idx: number) =>
    setFotosDevolucion(prev => prev.filter((_, i) => i !== idx));

  const limpiar = () => { limpiarBorrador(); };

  // Un borrador restaurado puede traer ids de registros que ya no existen o se desactivaron
  // (tara, lote, material, almacén, proveedor/cliente): se validan una vez, con los catálogos
  // ya cargados, y lo que no sirva queda sin elegir (con aviso) en vez de pesar/guardar mal.
  useEffect(() => {
    if (!saneoPendiente || !catalogosListos || !almacenesListos) return;
    const idsTara = taras.map(t => t.id);
    const idsProducto = productos.map(p => p.id);
    const idsLote = lotes.map(l => l.id);
    const idsAlmacen = almacenes.map(a => a.id);
    const idsEntidad = (tipo === 'compra' ? proveedores : clientes).map(e => e.id);
    const idsLoteOrigen = lotes
      .filter(l => l.stockPorAlmacen.some(s => s.almacenId === almacenOrigenId && s.stockKg > 0))
      .map(l => l.id);
    const reseteos: string[] = [];

    const saneo = sanearFilasRestauradas(materiales, { productoIds: idsProducto, loteIds: idsLote, taraIds: idsTara });
    const textoFilas = mensajeReseteos(saneo.reseteos);
    if (textoFilas) {
      setMateriales(saneo.filas);
      reseteos.push(textoFilas);
    }

    const lotesFantasma = loteFilas.filter(f => f.loteId && idVigenteOVacio(f.loteId, idsLoteOrigen) !== f.loteId).length;
    if (lotesFantasma > 0) {
      setLoteFilas(loteFilas.map(f => (f.loteId && idVigenteOVacio(f.loteId, idsLoteOrigen) !== f.loteId ? { ...f, loteId: '' } : f)));
      reseteos.push(lotesFantasma === 1 ? 'un lote a trasladar' : `${lotesFantasma} lotes a trasladar`);
    }
    if (idVigenteOVacio(almacenOrigenId, idsAlmacen) !== almacenOrigenId) { setAlmacenOrigenId(''); reseteos.push('el almacén de origen'); }
    if (idVigenteOVacio(almacenDestinoId, idsAlmacen) !== almacenDestinoId) { setAlmacenDestinoId(''); reseteos.push('el almacén de destino'); }
    if (tipo !== 'traslado' && idVigenteOVacio(entidadId, idsEntidad) !== entidadId) {
      setEntidadId('');
      reseteos.push(tipo === 'compra' ? 'el proveedor' : 'el cliente');
    }

    finalizarSaneo(mensajeSaneoBorrador(reseteos));
  }, [saneoPendiente, catalogosListos, almacenesListos, taras, productos, lotes, almacenes, proveedores, clientes, tipo, materiales, loteFilas, almacenOrigenId, almacenDestinoId, entidadId, setMateriales, setLoteFilas, setAlmacenOrigenId, setAlmacenDestinoId, setEntidadId, finalizarSaneo]);

  // Un lote puede tener kilos repartidos en varios almacenes — se muestran
  // acá los que tienen stock en el almacén de origen elegido (no bloquea
  // seleccionar otro: ver stockPorAlmacen en shared/types/lote.ts).
  const lotesEnOrigen = useMemo(
    () => lotes.filter(l => l.activo && l.stockPorAlmacen.some(s => s.almacenId === almacenOrigenId && s.stockKg > 0)),
    [lotes, almacenOrigenId]
  );

  const agregarLoteFila = () => setLoteFilas(prev => [...prev, loteTrasladoFilaVacia()]);
  const quitarLoteFila = (uid: number) => setLoteFilas(prev => prev.filter(f => f.uid !== uid));
  const setLoteFilaCampo = (uid: number, campo: 'loteId' | 'pesoBruto' | 'tara', valor: string) =>
    setLoteFilas(prev => prev.map(f => (f.uid === uid ? { ...f, [campo]: valor } : f)));
  const agregarFotosLoteFila = (uid: number, files: File[]) =>
    setLoteFilas(prev => prev.map(f => (f.uid === uid
      ? { ...f, fotos: [...f.fotos, ...files.map(file => ({ tipo: 'nueva' as const, file, preview: URL.createObjectURL(file) }))] }
      : f)));
  const quitarFotoLoteFila = (uid: number, idx: number) =>
    setLoteFilas(prev => prev.map(f => (f.uid === uid ? { ...f, fotos: f.fotos.filter((_, i) => i !== idx) } : f)));

  const guardarTraslado = async () => {
    setError(null);

    // Filas vacías se ignoran: el formulario siempre arranca con una fila
    // en blanco, y un traslado puede ser solo de lotes completos (sin
    // material suelto), o al revés.
    const materialesLlenos = materiales.filter(f => f.productoId);

    if (!almacenOrigenId) { setError('Elige el almacén de origen.'); return; }
    if (!almacenDestinoId) { setError('Elige el almacén de destino.'); return; }
    if (almacenOrigenId === almacenDestinoId) { setError('El almacén de origen y destino no pueden ser el mismo.'); return; }
    if (materialesLlenos.length === 0 && loteFilas.length === 0) {
      setError('Agrega al menos un material o un lote a trasladar.');
      return;
    }
    if (materialesLlenos.some(f => taraFilaNoVigente(f, taras))) { setError(MENSAJE_TARA_NO_VIGENTE); return; }
    if (materialesLlenos.some(f => netoFila(f, taras) < 0)) { setError('El peso neto de un material no puede ser negativo. Revisa bruto y tara.'); return; }
    if (materialesLlenos.some(f => netoFila(f, taras) <= 0)) { setError('Cada material debe tener un peso neto mayor a 0.'); return; }
    if (materialesLlenos.some(f => f.fotos.length === 0)) { setError('Cada material necesita al menos una foto.'); return; }
    if (loteFilas.some(f => !f.loteId)) { setError('Selecciona el lote de cada fila.'); return; }
    if (loteFilas.some(f => netoLoteTrasladoFila(f) <= 0)) { setError('Cada lote debe tener un peso neto mayor a 0.'); return; }
    if (loteFilas.some(f => f.fotos.length === 0)) { setError('Cada lote necesita al menos una foto del pesaje.'); return; }

    setGuardando(true);

    const materialesConFotos: Array<{ productoId: string; subcategoria: string | null; pesoBruto: number; tara: number; fotos: string[] }> = [];
    for (const f of materialesLlenos) {
      const urls = await subirFotosFila(f.fotos);
      if (!urls) {
        setError('No se pudo subir una de las fotos. Revisa que el bucket "tickets" exista en Supabase Storage.');
        setGuardando(false);
        return;
      }
      materialesConFotos.push({
        productoId: f.productoId,
        subcategoria: f.subcategoria.trim() || null,
        pesoBruto: Number(f.pesoBruto) || 0,
        tara: taraKgFila(f, taras),
        fotos: urls,
      });
    }

    const lotesConFotos: Array<{ loteId: string; pesoBruto: number; tara: number; fotos: string[] }> = [];
    for (const f of loteFilas) {
      const urls = await subirFotosFila(f.fotos);
      if (!urls) {
        setError('No se pudo subir una de las fotos. Revisa que el bucket "tickets" exista en Supabase Storage.');
        setGuardando(false);
        return;
      }
      lotesConFotos.push({
        loteId: f.loteId,
        pesoBruto: Number(f.pesoBruto) || 0,
        tara: Number(f.tara) || 0,
        fotos: urls,
      });
    }

    const result = await crearTraslado({
      almacenOrigenId,
      almacenDestinoId,
      materiales: materialesConFotos,
      lotes: lotesConFotos,
      vehiculo: vehiculo.trim() || null,
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
    if (!sinPesajeGlobal && sumaPesajesGlobales(pesajesGlobales) <= 0) {
      setError('Registra al menos un pesaje global con peso mayor a 0.');
      return;
    }
    if (!sinPesajeGlobal && pesajesGlobales.some(g => g.fotos.length === 0)) {
      setError('Cada pesaje global necesita al menos una foto.');
      return;
    }
    if (estado === 'completo') {
      if (materiales.some(f => !f.productoId)) { setError('Cada material debe tener un producto seleccionado.'); return; }
      if (materiales.some(f => !esFilaSinLote(f, productos) && !f.destino)) { setError('Cada material debe tener un destino seleccionado.'); return; }
      if (materiales.some(filaTaraIncompleta)) {
        setError('Selecciona la tara preconfigurada para las unidades ingresadas.');
        return;
      }
      if (materiales.some(f => taraFilaNoVigente(f, taras))) { setError(MENSAJE_TARA_NO_VIGENTE); return; }
      if (materiales.some(f => netoFila(f, taras) < 0)) { setError('El peso neto de un material no puede ser negativo. Revisa bruto y tara.'); return; }
      if (materiales.some(f => netoFila(f, taras) <= 0)) { setError('Cada material debe tener un peso neto mayor a 0.'); return; }
      if (materiales.some(f => f.fotos.length === 0)) { setError('Cada material necesita al menos una foto.'); return; }
      if (Number(devolucion) > 0 && fotosDevolucion.length === 0) { setError('Agrega al menos una foto de la devolución.'); return; }
      if (diferenciaFavoreceProveedor(diferencia, sinPesajeGlobal)) {
        setError('La suma de materiales + devolución supera el peso global — eso favorece al proveedor. Revisa los pesos antes de guardar.');
        return;
      }
    }

    setGuardando(true);

    // Fotos por material — cada línea sube las suyas (Bloque 46), en vez de
    // una sola galería general al final del ticket.
    const materialesConFotos: Array<ReturnType<typeof materialAPayload> & { fotos: string[] }> = [];
    if (estado !== 'bruto') {
      for (const f of materiales) {
        const urls = await subirFotosFila(f.fotos);
        if (!urls) {
          setError('No se pudo subir una de las fotos. Revisa que el bucket "tickets" exista en Supabase Storage.');
          setGuardando(false);
          return;
        }
        materialesConFotos.push({ ...materialAPayload(f, taras, productos), fotos: urls });
      }
    }

    let urlsDevolucion: string[] = [];
    if (estado !== 'bruto') {
      const urls = await subirFotosFila(fotosDevolucion);
      if (!urls) {
        setError('No se pudo subir una de las fotos de la devolución. Revisa que el bucket "tickets" exista en Supabase Storage.');
        setGuardando(false);
        return;
      }
      urlsDevolucion = urls;
    }

    const pesajesGlobalesPayload: Array<{ peso: number; tara?: number; fotos?: string[] }> = [];
    if (!sinPesajeGlobal) {
      for (const f of pesajesGlobales) {
        let fotosUrls: string[] = [];
        if (f.fotos.length > 0) {
          const uploaded = await subirFotosPesajeGlobal(f);
          if (!uploaded) {
            setError('No se pudo subir una foto del pesaje global. Revisa que el bucket "tickets" exista en Supabase Storage.');
            setGuardando(false);
            return;
          }
          fotosUrls = uploaded;
        }
        pesajesGlobalesPayload.push({ peso: Number(f.peso) || 0, tara: Number(f.tara) || 0, fotos: fotosUrls });
      }
    }

    const result = await crearTicket({
      tipo: tipo === 'venta' ? 'venta' : 'compra',
      entidadId,
      almacenId: almacenes.length > 1 ? (almacenOrigenId || almacenPredeterminado?.id || null) : null,
      fecha,
      pesoGlobal: sinPesajeGlobal ? null : sumaPesajesGlobales(pesajesGlobales),
      pesajesGlobales: pesajesGlobalesPayload,
      // El backend marca "sin peso global propio" con este flag.
      pesajeExterior: sinPesajeGlobal,
      devolucion: Number(devolucion) || 0,
      fotosDevolucion: urlsDevolucion,
      estado,
      materiales: materialesConFotos,
      fotos: [],
      observaciones: observaciones.trim() || null,
      vehiculo: vehiculo.trim() || null,
    });

    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    toast.exito(
      estado === 'bruto'
        ? `${result.ticket.codigo} guardado como pesaje global (por recepcionar). Complétalo luego desde la lista.`
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
  const fmt = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

  const filaActiva = materiales.find(f => f.uid === filaActivaUid) ?? materiales[0];

  const propsLista = {
    tickets,
    traslados,
    ticketsListos,
    nombrePorEntidad,
    puedeCrear,
    puedeEliminar: puedeEliminarTicket,
    puedeRecepcionarTraslado,
    puedeVerFacturacion: tienePermiso('facturacion', 'ver'),
    onCompletar: setTicketACompletar,
    onEliminar: handleEliminarTicket,
    onVerDetalle: (id: string) => navigate(`/pesaje/${id}`),
    onRecepcionarTraslado: setTrasladoARecepcionar,
    onIrANuevo: () => setPestana('nuevo'),
  };

  const paneles = (
    <>
      {pestana === 'nuevo' && (
      <div className={puedeVerTickets ? 'max-w-2xl' : 'grid grid-cols-1 lg:grid-cols-2 gap-6'}>
        {puedeCrear ? (
          <form onSubmit={handleSubmit} className="bg-surface rounded-xl border border-border p-5 space-y-4 h-fit">
            <AvisoBorrador formulario="pesaje" aviso={avisoRestauracion} onDescartar={descartarBorradorRestaurado} onCerrar={cerrarAvisoRestauracion} />
            {avisoSaneo && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">{avisoSaneo}</p>}
            {/* Toggle compra/venta/traslado */}
            <div>
              <label className={labelClass}>Tipo de operación</label>
              <div className="flex rounded-lg overflow-hidden border border-border text-sm w-full sm:w-fit">
                <button type="button" onClick={() => { setTipo('compra'); setEntidadId(''); }} className={`flex-1 sm:flex-none px-2 sm:px-4 py-1.5 text-center ${tipo === 'compra' ? 'bg-brand-600 text-white' : 'bg-surface-alt text-text-secondary'}`}>
                  Compra <span className="hidden sm:inline">(proveedor)</span>
                </button>
                <button type="button" onClick={() => { setTipo('venta'); setEntidadId(''); setPesajeExterior(false); }} className={`flex-1 sm:flex-none px-2 sm:px-4 py-1.5 text-center ${tipo === 'venta' ? 'bg-brand-600 text-white' : 'bg-surface-alt text-text-secondary'}`}>
                  Venta <span className="hidden sm:inline">(cliente)</span>
                </button>
                <button type="button" onClick={() => { setTipo('traslado'); setEntidadId(''); setPesajeExterior(false); }} className={`flex-1 sm:flex-none px-2 sm:px-4 py-1.5 text-center ${tipo === 'traslado' ? 'bg-brand-600 text-white' : 'bg-surface-alt text-text-secondary'}`}>
                  Traslado <span className="hidden sm:inline">(almacén)</span>
                </button>
              </div>
            </div>

            {tipo === 'traslado' ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Almacén origen *</label>
                  <button type="button" onClick={() => setMostrarSelectorAlmacenOrigen(true)} className={`${inputClass} flex items-center justify-between gap-2 text-left`}>
                    <span className={almacenOrigenId ? 'text-text-primary truncate' : 'text-text-muted'}>
                      {almacenes.find(a => a.id === almacenOrigenId)?.nombre ?? '— Selecciona —'}
                    </span>
                    <ChevronDown size={14} className="text-text-muted shrink-0" />
                  </button>
                </div>
                <div>
                  <label className={labelClass}>Almacén destino *</label>
                  <button type="button" onClick={() => setMostrarSelectorAlmacenDestino(true)} className={`${inputClass} flex items-center justify-between gap-2 text-left`}>
                    <span className={almacenDestinoId ? 'text-text-primary truncate' : 'text-text-muted'}>
                      {almacenes.find(a => a.id === almacenDestinoId)?.nombre ?? '— Selecciona —'}
                    </span>
                    <ChevronDown size={14} className="text-text-muted shrink-0" />
                  </button>
                </div>
              </div>
            ) : (
            <div className="grid grid-cols-2 gap-3">
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
                <label className={labelClass}>Fecha</label>
                <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className={inputClass} />
              </div>
            </div>
            )}

            {tipo === 'compra' && (
              <TicketsBrutoProveedor tickets={ticketsBrutoProveedor} onContinuar={setTicketACompletar} />
            )}

            {tipo !== 'traslado' && (
              almacenes.length > 1 ? (
                <div>
                  <label className={labelClass}>Almacén</label>
                  <select
                    value={almacenOrigenId || almacenPredeterminado?.id || ''}
                    onChange={e => setAlmacenOrigenId(e.target.value)}
                    className={inputClass}
                  >
                    {almacenes.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.nombre}{a.esPredeterminado ? ' (predeterminado)' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-text-muted mt-1">
                    {tipo === 'compra'
                      ? 'Esta compra entra al inventario de este almacén. No limita ni bloquea nada, es solo para saber dónde quedó el material.'
                      : 'Esta venta sale del inventario de este almacén. No limita ni bloquea nada, es solo para saber de dónde salió el material.'}
                  </p>
                </div>
              ) : almacenPredeterminado ? (
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
              {tipo === 'compra' && (
                <label className="flex items-center gap-2 mb-4 text-sm font-medium text-text-primary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pesajeExterior}
                    onChange={e => setPesajeExterior(e.target.checked)}
                    className="rounded border-border"
                  />
                  Peso exterior (sin pesaje global)
                </label>
              )}
              <h3 className="text-lg font-bold text-text-primary mb-2">Pesaje global {sinPesajeGlobal ? '' : '*'}</h3>
              {sinPesajeGlobal ? (
                <p className="text-xs text-text-muted">Sin pesaje global: la compra se registra con el peso exterior, sin peso global para reconciliar.</p>
              ) : (
              <div className="space-y-2">
                {pesajesGlobales.map((f, idx) => {
                  const neto = netoPesajeGlobalFila(f);
                  return (
                    <div key={f.uid} className="border border-border rounded-lg p-3 space-y-2 bg-surface-alt/40">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-text-secondary">Pesaje {idx + 1}</span>
                        {pesajesGlobales.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setPesajesGlobales(prev => prev.filter(p => p.uid !== f.uid))}
                            className="text-text-muted hover:text-red-600 transition-colors"
                            title="Quitar pesaje"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={labelClass}>Peso bruto (kg)</label>
                          <input
                            type="number" step="0.001" min="0"
                            value={f.peso}
                            onChange={e => setPesajesGlobales(prev => prev.map(p => p.uid === f.uid ? { ...p, peso: e.target.value } : p))}
                            className={inputClass}
                            placeholder="0.000"
                          />
                        </div>
                        <div>
                          <label className={labelClass}>Tara (kg)</label>
                          <input
                            type="number" step="0.001" min="0"
                            value={f.tara}
                            onChange={e => setPesajesGlobales(prev => prev.map(p => p.uid === f.uid ? { ...p, tara: e.target.value } : p))}
                            className={inputClass}
                            placeholder="0.000"
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2 text-sm">
                        <span className="text-text-muted">Neto</span>
                        <span className={`font-semibold ${neto < 0 ? 'text-red-600' : 'text-text-primary'}`}>{fmt(neto)} kg</span>
                      </div>
                      <FotoMaterialPicker
                        label="Fotos del pesaje"
                        fotos={f.fotos}
                        onAgregar={files => {
                          const nuevas = files.map(file => ({ tipo: 'nueva' as const, file, preview: URL.createObjectURL(file) }));
                          setPesajesGlobales(prev => prev.map(p => p.uid === f.uid
                            ? { ...p, fotos: [...p.fotos, ...nuevas] }
                            : p
                          ));
                        }}
                        onQuitar={idx => setPesajesGlobales(prev => prev.map(p => p.uid === f.uid
                          ? { ...p, fotos: p.fotos.filter((_, i) => i !== idx) }
                          : p
                        ))}
                      />
                    </div>
                  );
                })}
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setPesajesGlobales(prev => [...prev, pesajeGlobalVacio()])}
                    className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors"
                  >
                    <Plus size={16} />
                    Agregar pesaje
                  </button>
                  {pesajesGlobales.length > 1 && (
                    <span className="text-xs text-text-secondary">
                      Total: <span className="font-semibold text-text-primary">{fmt(sumaPesajesGlobales(pesajesGlobales))} kg</span>
                    </span>
                  )}
                </div>
              </div>
              )}
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
                      <div className={tipo === 'traslado' ? 'col-span-2' : ''}>
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
                      {tipo !== 'traslado' && (
                        <div>
                          {esFilaSinLote(f, productos) ? (
                            <>
                              <label className={labelClass}>&nbsp;</label>
                              <p className="text-xs text-text-muted bg-surface-alt border border-border rounded-lg px-3 py-2">
                                Categoría sin lote — va directo a inventario general.
                              </p>
                            </>
                          ) : (
                            <>
                              <label className={labelClass}>{tipo === 'venta' ? 'Origen (inventario) *' : 'Destino (inventario) *'}</label>
                              <button
                                type="button"
                                onClick={() => { setFilaLoteActivaUid(f.uid); setMostrarSelectorLote(true); }}
                                className={`${inputClass} flex items-center justify-between gap-2 text-left`}
                              >
                                <span className={f.destino ? 'text-text-primary truncate' : 'text-text-muted'}>
                                  {lotes.find(l => l.id === f.destino)?.nombre ?? '— Selecciona —'}
                                </span>
                                <ChevronDown size={14} className="text-text-muted shrink-0" />
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 items-center">
                      {/* Las 4 celdas son hermanas directas del grid (no divs anidados por
                          columna) a propósito: así CSS Grid iguala la altura de la fila 1
                          (labels) entre ambas columnas automáticamente, sin importar que la
                          de Tara traiga el toggle Preconfigurada/Manual y la de Peso bruto
                          no — evita que los inputs de la fila 2 queden a distinta altura.
                          Orden: Tara queda debajo de Material, Peso bruto debajo de Destino. */}
                      <div className="flex items-center justify-between gap-1 sm:gap-2 min-w-0">
                        <label className="text-xs font-medium text-text-secondary shrink-0">Tara</label>
                        <div className="flex rounded-md overflow-hidden border border-border text-[9px] sm:text-[11px] shrink-0 min-w-0">
                          <button type="button" onClick={() => setFila(f.uid, 'taraModo', 'preconfigurada')} className={`px-1 sm:px-2 py-1 truncate ${f.taraModo === 'preconfigurada' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
                            Preconfigurada
                          </button>
                          <button type="button" onClick={() => setFila(f.uid, 'taraModo', 'manual')} className={`px-1 sm:px-2 py-1 truncate ${f.taraModo === 'manual' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
                            Manual
                          </button>
                        </div>
                      </div>
                      <label className="text-xs font-medium text-text-secondary">Peso bruto (kg)</label>

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
                              <CantidadTaraInput value={f.taraCantidad} onChange={v => setFila(f.uid, 'taraCantidad', v)} />
                            </div>
                            <p className="text-[11px] text-text-muted mt-1">= {fmt(taraKgFila(f, taras))} kg</p>
                          </div>
                        ) : (
                          <input type="number" step="0.001" min="0" value={f.taraManual} onChange={e => setFila(f.uid, 'taraManual', e.target.value)} className={inputClass} placeholder="0.00" />
                        )}
                      </div>
                      <input type="number" step="0.001" min="0" value={f.pesoBruto} onChange={e => setFila(f.uid, 'pesoBruto', e.target.value)} className={inputClass + ' self-start'} placeholder="0.00" />
                    </div>

                    <TarasExtraEditor
                      extras={f.tarasExtra ?? []}
                      taras={taras}
                      onChange={extras => setMateriales(prev => prev.map(x => (x.uid === f.uid ? { ...x, tarasExtra: extras } : x)))}
                    />

                    <div className="flex items-center justify-end gap-2 text-sm">
                      <span className="text-text-muted">Neto del material</span>
                      <span className={`font-semibold ${neto < 0 ? 'text-red-600' : 'text-text-primary'}`}>{fmt(neto)} kg</span>
                    </div>

                    <FotoMaterialPicker
                      fotos={f.fotos}
                      onAgregar={files => agregarFotosFila(f.uid, files)}
                      onQuitar={idx => quitarFotoFila(f.uid, idx)}
                    />

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

                    {tipo === 'venta' && f.productoId && (() => {
                      const disponible = stockGlobalDisponible.get(f.productoId) ?? 0;
                      if (neto <= disponible) return null;
                      return (
                        <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
                          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                          <span>
                            El negocio tiene {fmt(disponible)} kg registrados de este material — el inventario quedará en {fmt(disponible - neto)} kg. Esto no impide la venta, es solo un aviso.
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}

              <button
                type="button"
                onClick={agregarMaterial}
                disabled={faltaParaAgregar.length > 0}
                className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus size={16} />
                Agregar material
              </button>
              {faltaParaAgregar.length > 0 && (
                <p role="status" className="text-xs text-amber-700">
                  Para agregar otro material completa el actual. Falta: {faltaParaAgregar.join(', ')}.
                </p>
              )}
            </div>

            {tipo === 'traslado' && almacenOrigenId && (
              <div className="space-y-3">
                <label className={labelClass + ' mb-0'}>Lotes a trasladar (PCB)</label>

                {loteFilas.map((f, idx) => {
                  const neto = netoLoteTrasladoFila(f);
                  const opcionesLote = lotesEnOrigen.filter(l => l.id === f.loteId || !loteFilas.some(o => o.uid !== f.uid && o.loteId === l.id));
                  const loteSel = lotes.find(l => l.id === f.loteId);
                  const stockEnOrigen = loteSel?.stockPorAlmacen.find(s => s.almacenId === almacenOrigenId)?.stockKg ?? 0;
                  return (
                    <div key={f.uid} className="border border-border rounded-lg p-3 space-y-3 bg-surface-alt/40">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-text-secondary">Lote {idx + 1}</span>
                        <button type="button" onClick={() => quitarLoteFila(f.uid)} className="text-text-muted hover:text-red-600 transition-colors" title="Quitar lote">
                          <Trash2 size={15} />
                        </button>
                      </div>
                      <div>
                        <label className={labelClass}>Lote *</label>
                        <select value={f.loteId} onChange={e => setLoteFilaCampo(f.uid, 'loteId', e.target.value)} className={inputClass}>
                          <option value="">— Selecciona —</option>
                          {opcionesLote.map(l => {
                            const kgEnOrigen = l.stockPorAlmacen.find(s => s.almacenId === almacenOrigenId)?.stockKg ?? 0;
                            return <option key={l.id} value={l.id}>{l.nombre} ({fmt(kgEnOrigen)} kg en este almacén)</option>;
                          })}
                        </select>
                        {f.loteId && (
                          <p className="text-[11px] text-text-muted mt-1">Disponible en este almacén: {fmt(stockEnOrigen)} kg</p>
                        )}
                        {/* La composición que viaja es la de ESTE almacén de
                            origen (se congela al pesar) — no la del lote en
                            otro almacén. */}
                        {f.loteId && (loteSel?.stockPorAlmacen.find(s => s.almacenId === almacenOrigenId)?.composicion.length ?? 0) > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {loteSel?.stockPorAlmacen.find(s => s.almacenId === almacenOrigenId)?.composicion.map(c => (
                              <span key={c.item} className="text-[11px] bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
                                {c.item}: {c.porcentaje}%
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={labelClass}>Peso bruto (kg)</label>
                          <input type="number" step="0.001" min="0" value={f.pesoBruto} onChange={e => setLoteFilaCampo(f.uid, 'pesoBruto', e.target.value)} className={inputClass} placeholder="0.00" />
                        </div>
                        <div>
                          <label className={labelClass}>Tara (kg)</label>
                          <input type="number" step="0.001" min="0" value={f.tara} onChange={e => setLoteFilaCampo(f.uid, 'tara', e.target.value)} className={inputClass} placeholder="0.00" />
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2 text-sm">
                        <span className="text-text-muted">Neto del lote</span>
                        <span className={`font-semibold ${neto < 0 ? 'text-red-600' : 'text-text-primary'}`}>{fmt(neto)} kg</span>
                      </div>
                      <FotoMaterialPicker
                        fotos={f.fotos}
                        onAgregar={files => agregarFotosLoteFila(f.uid, files)}
                        onQuitar={idx2 => quitarFotoLoteFila(f.uid, idx2)}
                      />
                    </div>
                  );
                })}

                <button type="button" onClick={agregarLoteFila} disabled={lotesEnOrigen.length === 0} className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  <Plus size={16} />
                  Agregar lote
                </button>
                {lotesEnOrigen.length === 0 && <p className="text-xs text-text-muted">No hay lotes con stock en el almacén de origen.</p>}
                <p className="text-xs text-text-muted">Puedes trasladar una porción del lote (pésala) — el resto sigue en el almacén de origen. Llega al destino cuando se confirme la recepción.</p>
              </div>
            )}

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
                  step="0.001"
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
              <FotoMaterialPicker
                label="Fotos de la devolución"
                fotos={fotosDevolucion}
                onAgregar={agregarFotosDevolucion}
                onQuitar={quitarFotoDevolucion}
              />
              {!sinPesajeGlobal && (
                <div className="flex items-center justify-between text-sm border-t border-brand-200 pt-2">
                  <span className="text-brand-800">Diferencia (global vs. neto + devolución)</span>
                  <span className={`font-semibold ${colorClaseDiferencia(diferencia, sumaPesajesGlobales(pesajesGlobales), sinPesajeGlobal)}`}>
                    {fmt(diferencia)} kg
                    <span className="ml-1 font-normal text-xs text-brand-700">({descripcionDiferencia(diferencia)})</span>
                  </span>
                </div>
              )}
              </>
              )}
            </div>

            <VehiculoSelector value={vehiculo} onChange={setVehiculo} vehiculos={vehiculos} inputClass={inputClass} labelClass={labelClass} />

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
                Guardar pesaje global, completar después
              </button>
            )}

          </form>
        ) : (
          <p className="text-text-muted text-sm">No tienes permiso para registrar pesajes.</p>
        )}

        {!puedeVerTickets && (
          <TicketsSeccion compacta {...propsLista} />
        )}
      </div>
      )}

      {pestana === 'tickets' && puedeVerTickets && (
        <TicketsSeccion {...propsLista} />
      )}
    </>
  );

  return (
    <div>
      <EncabezadoPagina
        titulo="Pesaje"
        subtitulo="Registra la pesada del material antes de facturar y sigue qué falta recepcionar, facturar o revisar."
      />

      {tomasFisicasAbiertas.length > 0 && (
        <ul aria-label="Tomas físicas abiertas" className="mb-6 space-y-2">
          {tomasFisicasAbiertas.map(t => (
            <AlertaItem
              key={t.id}
              severidad="amarilla"
              texto={`Hay una toma física abierta en ${t.almacenNombre} (${t.codigo}): ${t.categoriaNombres.join(', ')} está bloqueado ahí hasta cerrarla.`}
              enlace={{ to: `/pesaje/conteo/${t.id}`, etiqueta: 'Registrar conteo' }}
            />
          ))}
        </ul>
      )}

      {puedeVerTickets ? (
        <Pestanas<Pestana>
          etiquetaAria="Secciones de Pesaje"
          pestanas={[{ valor: 'nuevo', etiqueta: 'Nuevo pesaje' }, { valor: 'tickets', etiqueta: 'Tickets' }]}
          valor={pestana}
          onCambiar={setPestana}
        >
          {paneles}
        </Pestanas>
      ) : paneles}

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
            const lotesDelProducto = productos.find(p => p.id === productoId)?.loteIds ?? [];
            setMateriales(prev => prev.map(f => (f.uid === uid && lotesDelProducto.length > 0 && f.destino && !lotesDelProducto.includes(f.destino) ? { ...f, destino: '' } : f)));
            setFila(uid, 'productoId', productoId);
            setMostrarSelectorMaterial(false);
            // Si el material maneja lote, se abre de inmediato el selector de lote.
            if (tipo !== 'traslado' && productoRequiereLote(productoId, productos)) {
              setFilaLoteActivaUid(uid);
              setMostrarSelectorLote(true);
            }
          }}
        />
      )}

      {mostrarSelectorTara && (
        <SeleccionarTaraModal
          taras={taras}
          taraSeleccionada={filaActiva?.taraId}
          onClose={() => setMostrarSelectorTara(false)}
          onSeleccionar={taraId => {
            const uid = filaActiva?.uid ?? materiales[0].uid;
            setMateriales(prev => prev.map(f => (f.uid === uid ? { ...f, ...seleccionarTaraFila(f, taraId) } : f)));
            setMostrarSelectorTara(false);
          }}
        />
      )}
      {mostrarSelectorEntidad && (
        <SeleccionarEntidadModal
          titulo={labelEntidad}
          entidades={entidades}
          onClose={() => setMostrarSelectorEntidad(false)}
          onSeleccionar={id => { setEntidadId(id); setMostrarSelectorEntidad(false); }}
        />
      )}
      {mostrarSelectorLote && (
        <SeleccionarEntidadModal
          titulo={tipo === 'venta' ? 'Origen (inventario)' : 'Destino (inventario)'}
          entidades={lotesSelector.opciones.map(l => ({ id: l.id, nombre: l.actualNoAnclado ? `${l.nombre} (actual, no anclado)` : l.nombre, activo: l.activo, fotos: l.fotos, destacado: l.anclado }))}
          mensajeVacio={lotesSelector.sinDisponibles ? 'Los lotes anclados a este material no están disponibles (inactivos). Reactívalos o cambia el anclaje en Productos.' : undefined}
          etiquetaDestacados="Lotes posibles de este material"
          onClose={() => setMostrarSelectorLote(false)}
          onSeleccionar={id => {
            if (filaLoteActivaUid !== null) setFila(filaLoteActivaUid, 'destino', id);
            setMostrarSelectorLote(false);
          }}
        />
      )}
      {mostrarSelectorAlmacenOrigen && (
        <SeleccionarEntidadModal
          titulo="Almacén origen"
          entidades={almacenes.map(a => ({ id: a.id, nombre: a.nombre, activo: a.activo, fotos: a.fotos }))}
          onClose={() => setMostrarSelectorAlmacenOrigen(false)}
          onSeleccionar={id => { setAlmacenOrigenId(id); setMostrarSelectorAlmacenOrigen(false); }}
        />
      )}
      {mostrarSelectorAlmacenDestino && (
        <SeleccionarEntidadModal
          titulo="Almacén destino"
          entidades={almacenes.filter(a => a.id !== almacenOrigenId).map(a => ({ id: a.id, nombre: a.nombre, activo: a.activo, fotos: a.fotos }))}
          onClose={() => setMostrarSelectorAlmacenDestino(false)}
          onSeleccionar={id => { setAlmacenDestinoId(id); setMostrarSelectorAlmacenDestino(false); }}
        />
      )}
    </div>
  );
}

export default PesajePage;
