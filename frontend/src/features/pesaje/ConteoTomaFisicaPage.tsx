import { useEffect, useMemo, useState } from 'react';
import { useBorradorPersistente } from '../../hooks/use-borrador-persistente';
import AvisoBorrador from '../../components/AvisoBorrador';
import { difiereEstado } from '../../lib/borrador';
import { idVigenteOVacio, mensajeSaneoBorrador, sanearTara } from '../../lib/borrador-vigentes';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronDown, Trash2, Images, ZoomIn, X } from 'lucide-react';
import { obtenerTomaFisica, obtenerResumenTomaFisica, eliminarPesajeTomaFisica } from '../../services/toma-fisica-service';
import { registrarPesajeTomaFisicaF4 } from '../../services/toma-fisica-cola';
import { conNombresDePendientes } from '../../lib/offline/f4/pendientes-f4';
import { obtenerProductos } from '../../services/producto-service';
import { obtenerLotes } from '../../services/lote-service';
import { obtenerTaras } from '../../services/tara-service';
import { taraKgFila, taraFilaNoVigente, MENSAJE_TARA_NO_VIGENTE, seleccionarTaraFila, taraVacia, type CampoTara, type FotoMaterial } from './material-fila';
import FotoMaterialPicker from './FotoMaterialPicker';
import SeleccionarMaterialModal from './SeleccionarMaterialModal';
import SeleccionarTaraModal from './SeleccionarTaraModal';
import CantidadTaraInput from './CantidadTaraInput';
import { useToast } from '../../hooks/use-toast-context';
import type { TomaFisicaInventario, DetalleTomaFisica, Producto, Lote, Tara, ResumenTomaFisicaLinea } from '@shared/types/index.js';
import VisorFotos from '../../components/VisorFotos';
import { BotonAccion, Bloque, EncabezadoPagina, EstadoVacio, SkeletonBloque } from '../../components/ui';
import TomaFisicaChecklistConteo from './TomaFisicaChecklistConteo';

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ConteoTomaFisicaPage() {
  const { tomaFisicaId = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const [preseleccionAplicada, setPreseleccionAplicada] = useState(false);

  const [tomaFisica, setTomaFisica] = useState<TomaFisicaInventario | null>(null);
  const [detalle, setDetalle] = useState<DetalleTomaFisica[]>([]);
  const [lineas, setLineas] = useState<ResumenTomaFisicaLinea[]>([]);
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
  const [catalogosListos, setCatalogosListos] = useState(false);
  const [avisoSaneo, setAvisoSaneo] = useState<string | null>(null);

  const [galeriaAbierta, setGaleriaAbierta] = useState<{ label: string; fotos: string[] } | null>(null);
  const [fotoAmpliada, setFotoAmpliada] = useState<string | null>(null);

  // Al cambiar de toma física se vuelve a mostrar el spinner (derivado durante
  // el render; el efecto ya no hace setState síncrono).
  const [tomaCargada, setTomaCargada] = useState(tomaFisicaId);
  if (tomaFisicaId !== tomaCargada) {
    setTomaCargada(tomaFisicaId);
    setCargando(true);
  }

  const traerDatos = () => {
    Promise.all([
      obtenerTomaFisica(tomaFisicaId),
      obtenerResumenTomaFisica(tomaFisicaId),
      obtenerProductos(),
      obtenerLotes(),
      obtenerTaras(),
    ]).then(([res, resumen, prods, lts, tars]) => {
      if (res) { setTomaFisica(res.tomaFisica); setDetalle(conNombresDePendientes(res.detalle, prods, lts)); }
      setLineas(resumen);
      setProductos(prods);
      setLotes(lts);
      setTaras(tars.filter(t => t.activo));
      setCatalogosListos(true);
      setCargando(false);
    });
  };

  // Recarga manual (tras registrar un pesaje): vuelve a mostrar el spinner.
  const cargar = () => {
    setCargando(true);
    traerDatos();
  };

  useEffect(() => { traerDatos(); }, [tomaFisicaId]);

  // Si esta toma física ya se culminó (ej. en otra pestaña, o volviendo con
  // el botón atrás del navegador a un enlace viejo), no tiene sentido dejar
  // al usuario en un formulario muerto — lo mandamos directo al resultado.
  useEffect(() => {
    if (tomaFisica && tomaFisica.estado !== 'abierta') {
      const msg = tomaFisica.estado === 'cancelada'
        ? `${tomaFisica.codigo} fue cancelada.`
        : `${tomaFisica.codigo} ya fue culminada — te llevamos al resultado.`;
      toast.info(msg);
      navigate(`/inventario/toma-fisica/${tomaFisicaId}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tomaFisica]);

  // Alcance "Por lote" (PCB, PGM): un lote mezclado no se puede desarmar
  // material por material al contarlo físicamente — se pesa el lote
  // completo, sin elegir material. El alcance se eligió al iniciar la toma.
  const esConLote = tomaFisica?.alcance === 'lote';
  const stockLoteEnAlmacen = (l: Lote) =>
    l.stockPorAlmacen.find(s => s.almacenId === tomaFisica?.almacenId)?.stockKg ?? 0;

  // Solo materiales de las categorías elegidas para esta toma física
  // (categorías "sin lote" — Ferroso/No Ferroso).
  const productosDisponibles = useMemo(
    () => productos.filter(p =>
      p.activo
      && tomaFisica?.categoriaIds.includes(p.tipoMaterialId ?? '')
      // Toma selectiva: solo los materiales elegidos al crearla (vacio = toda la categoria).
      && (!tomaFisica.productoIds?.length || tomaFisica.productoIds.includes(p.id))
    ),
    [productos, tomaFisica]
  );
  const productoSel = productosDisponibles.find(p => p.id === productoId);
  // Solo pide lote cuando el material es de una categoría con lote — y solo
  // entre los lotes de esta toma física (si se acotó a lotes específicos al
  // crearla) o todos los del almacén (si no se acotó).
  const requiereLote = productoSel != null && productoSel.tipoMaterialSinLote !== true;
  // No se exige que el lote ya tenga stock registrado en este almacén — la
  // toma física sirve justo para contar lo que hay de verdad, incluso si el
  // sistema todavía no sabe que este lote está (o quedó en 0) acá.
  const lotesDelAlmacen = useMemo(
    () => lotes.filter(l =>
      l.activo
      && (!tomaFisica?.loteIds.length || tomaFisica.loteIds.includes(l.id))
    ),
    [lotes, tomaFisica]
  );

  // Lo que está en el formulario de conteo (las pesadas ya registradas viven en el servidor).
  // Qué cuenta como "cambio": peso, tara o fotos. El material/lote elegidos solos no justifican
  // un borrador (vienen a menudo del link "Teórico vs. real" y reaparecerían como borrador casi vacío).
  const estadoBorrador = { productoId, loteId, pesoBruto, campoTara, fotos };
  const restablecerConteo = () => {
    setProductoId('');
    setLoteId('');
    setPesoBruto('');
    setCampoTara(taraVacia());
    setFotos([]);
    setAvisoSaneo(null);
  };
  const borrador = useBorradorPersistente<typeof estadoBorrador>({
    formulario: 'toma-fisica-conteo',
    docId: tomaFisicaId,
    version: 1,
    // Sin catálogos cargados no se puede validar el borrador: se espera a tenerlos.
    habilitado: tomaFisicaId !== '' && catalogosListos,
    // Si el link trae ?producto o ?lote el usuario viene a contar eso: no se restaura un borrador ajeno a esa intención.
    restaurar: !searchParams.get('producto') && !searchParams.get('lote'),
    estado: estadoBorrador,
    hayCambios: difiereEstado({ pesoBruto, campoTara, fotos }, { pesoBruto: '', campoTara: taraVacia(), fotos: [] }),
    aplicar: d => {
      // Material, lote o tara que ya no existen (o se desactivaron) quedan sin elegir, con aviso.
      const reseteos: string[] = [];
      const productoOk = idVigenteOVacio(d.productoId ?? '', productosDisponibles.map(p => p.id));
      const loteOk = idVigenteOVacio(d.loteId ?? '', lotesDelAlmacen.map(l => l.id));
      if (productoOk !== (d.productoId ?? '')) reseteos.push('el material');
      if (loteOk !== (d.loteId ?? '')) reseteos.push('el lote');
      const tara = sanearTara({ ...taraVacia(), ...d.campoTara }, taras.map(t => t.id));
      if (tara.cambiada) reseteos.push('la tara');
      setAvisoSaneo(mensajeSaneoBorrador(reseteos));
      setProductoId(productoOk);
      setLoteId(loteOk);
      setPesoBruto(d.pesoBruto ?? '');
      setCampoTara(tara.fila);
      setFotos(d.fotos ?? []);
    },
    restablecer: restablecerConteo,
  });

  // Preselección desde el link "Teórico vs. real" de la toma física
  // (?producto=<id> o ?lote=<id>) — solo una vez, para no pisar la
  // selección del usuario cada vez que cargar() trae listas nuevas.
  // Se resuelve durante el render (estado derivado), no en un efecto.
  if (!preseleccionAplicada) {
    const productoParam = searchParams.get('producto');
    const loteParam = searchParams.get('lote');
    if (productoParam && productosDisponibles.some(p => p.id === productoParam)) {
      setProductoId(productoParam);
      setPreseleccionAplicada(true);
    } else if (loteParam && lotesDelAlmacen.some(l => l.id === loteParam)) {
      setLoteId(loteParam);
      setPreseleccionAplicada(true);
    }
  }

  const loteSeleccionado = loteId ? lotes.find(l => l.id === loteId) ?? null : null;
  const netoActual = (Number(pesoBruto) || 0) - taraKgFila(campoTara, taras);

  // Composición estimada del lote DESPUÉS de registrar este pesaje.
  // En toma física, netoActual ES el total real contado — no se suma al
  // stock existente. Items que quedarían ≤ 0 kg se omiten.
  const composicionProyectada = useMemo(() => {
    if (!loteSeleccionado || loteSeleccionado.composicion.length === 0) return null;
    if (pesoBruto === '' || netoActual < 0) return null;
    const nuevoStock = netoActual;
    const items = loteSeleccionado.composicion
      .map(c => ({ item: c.item, kg: (c.porcentaje / 100) * nuevoStock }))
      .filter(c => c.kg > 0);
    return items.length > 0 ? items : null;
  }, [loteSeleccionado, netoActual, pesoBruto]);

  const agregarFotos = (files: File[]) =>
    setFotos(prev => [...prev, ...files.map(file => ({ tipo: 'nueva' as const, file, preview: URL.createObjectURL(file) }))]);
  const quitarFoto = (idx: number) => setFotos(prev => prev.filter((_, i) => i !== idx));

  const handleAgregar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (esConLote) {
      if (!loteId) { setError('Elige el lote a contar.'); return; }
    } else {
      if (!productoId) { setError('Elige un material.'); return; }
      if (requiereLote && !loteId) { setError('Elige el lote donde está este material.'); return; }
    }
    if (pesoBruto === '') { setError('Ingresa el peso bruto (puede ser 0 si no había material).'); return; }
    if (taraFilaNoVigente(campoTara, taras)) { setError(MENSAJE_TARA_NO_VIGENTE); return; }
    if (netoActual < 0) { setError('El peso neto no puede ser negativo.'); return; }
    if (fotos.length === 0) { setError('Agrega al menos una foto.'); return; }

    setGuardando(true);
    // En línea sube las fotos y registra; sin conexión guarda el conteo y sus fotos en el teléfono (cola).
    const result = await registrarPesajeTomaFisicaF4(tomaFisicaId, {
      productoId: esConLote ? null : productoId,
      loteId: esConLote ? loteId : (requiereLote ? loteId : null),
      pesoBruto: Number(pesoBruto) || 0,
      tara: taraKgFila(campoTara, taras),
    }, fotos, productoSel?.nombre ?? loteSeleccionado?.nombre);
    setGuardando(false);
    if ('error' in result) { setError(result.error); return; }

    if (result.enCola) toast.info('Conteo guardado en el teléfono. Se enviará solo al volver la conexión.');
    else toast.exito('Pesaje registrado.');
    borrador.limpiar();
    setPesoBruto('');
    setCampoTara(taraVacia());
    setFotos([]);
    setProductoId('');
    setLoteId('');
    cargar();
  };

  const handleQuitar = async (detalleId: string) => {
    const result = await eliminarPesajeTomaFisica(tomaFisicaId, detalleId);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    cargar();
  };

  // Entradas grandes (móvil primero): 16 px evita el zoom de iOS y 48 px de alto es cómodo con guantes o prisa.
  const inputClass = "w-full min-h-12 px-3 py-3 bg-surface-alt border border-border rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-sm font-medium text-text-secondary mb-1";

  if (cargando) {
    return (
      <div className="max-w-xl" aria-busy="true">
        <div className="mb-6 h-12 w-56 animate-pulse rounded bg-surface-hover" />
        <SkeletonBloque alto="h-40" conMargen />
        <SkeletonBloque alto="h-72" />
      </div>
    );
  }

  if (!tomaFisica) {
    return (
      <div className="max-w-xl">
        <EstadoVacio
          mensaje="No encontramos esta toma física."
          descripcion="Puede que el enlace sea antiguo o que la toma ya no exista."
          accion={{ etiqueta: 'Volver a las tomas físicas', to: '/inventario-legacy?pestana=toma-fisica' }}
        />
      </div>
    );
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

  const totalNeto = detalle.reduce((acc, d) => acc + d.pesoNeto, 0);

  return (
    <div className="max-w-xl">
      <EncabezadoPagina
        migas={[
          { etiqueta: 'Inventario', to: '/inventario' },
          { etiqueta: 'Tomas físicas', to: '/inventario-legacy?pestana=toma-fisica' },
          { etiqueta: tomaFisica.codigo, to: `/inventario/toma-fisica/${tomaFisicaId}` },
          { etiqueta: 'Conteo' },
        ]}
        titulo="Conteo físico"
        subtitulo={`${tomaFisica.almacenNombre ?? 'Almacén'} · ${esConLote ? 'Por lote' : 'Por categoría'} · ${tomaFisica.categoriaNombres.join(', ')}${esConLote
          ? ' — se pesa el lote completo, no un material puntual.'
          : ' — pesaje simple, sin destino ni pesaje global.'}`}
        acciones={<BotonAccion variante="secundario" to={`/inventario/toma-fisica/${tomaFisicaId}`} icono={<ArrowLeft size={16} />}>{tomaFisica.codigo}</BotonAccion>}
      />

      <TomaFisicaChecklistConteo
        lineas={lineas}
        esConLote={esConLote}
        seleccionadoId={esConLote ? loteId : productoId}
        onElegir={l => {
          if (esConLote) setLoteId(l.loteId ?? '');
          else { setProductoId(l.productoId ?? ''); setLoteId(''); }
        }}
      />

      <Bloque titulo="Registrar un pesaje" queEstasViendo="Elige el material, anota el peso y la tara (peso del envase) y agrega al menos una foto. El peso neto (peso menos tara) se calcula solo y el pesaje queda guardado al tocar Agregar.">
      <form onSubmit={handleAgregar} className="space-y-5 bg-surface rounded-xl border border-border p-4 sm:p-5">
        <AvisoBorrador formulario="este conteo" aviso={borrador.aviso} onDescartar={borrador.descartar} onCerrar={borrador.cerrarAviso} />
        {avisoSaneo && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">{avisoSaneo}</p>}
        {esConLote ? (
          <div>
            <label htmlFor="conteo-lote" className={labelClass}>Lote *</label>
            <select id="conteo-lote" value={loteId} onChange={e => setLoteId(e.target.value)} className={inputClass}>
              <option value="">Selecciona…</option>
              {lotesDelAlmacen.map(l => <option key={l.id} value={l.id}>{l.nombre} — {fmt(stockLoteEnAlmacen(l))} kg en el sistema</option>)}
            </select>
            {lotesDelAlmacen.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">Este almacén no tiene lotes activos todavía.</p>
            )}
            {loteSeleccionado && loteSeleccionado.composicion.length > 0 && (
              <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                <p className="text-[11px] font-medium text-amber-800 mb-1.5">
                  Composición real de este lote, calculada por el sistema:
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
        ) : (
          <>
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
            <ChevronDown size={16} className="text-text-muted shrink-0" />
          </button>
        </div>

        {requiereLote && (
          <div>
            <label htmlFor="conteo-lote-material" className={labelClass}>Lote *</label>
            <select id="conteo-lote-material" value={loteId} onChange={e => setLoteId(e.target.value)} className={inputClass}>
              <option value="">Selecciona…</option>
              {lotesDelAlmacen.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
            </select>
            {lotesDelAlmacen.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">Este almacén no tiene lotes activos todavía.</p>
            )}
            {loteSeleccionado && loteSeleccionado.composicion.length > 0 && (
              <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                <p className="text-[11px] font-medium text-amber-800 mb-1.5">
                  Composición real de este lote, calculada por el sistema:
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
          </>
        )}

        <div>
          <label htmlFor="conteo-peso-bruto" className={labelClass}>Peso bruto (kg) *</label>
          <input id="conteo-peso-bruto" type="number" inputMode="decimal" step="0.001" min="0" value={pesoBruto} onChange={e => setPesoBruto(e.target.value)} className={`${inputClass} text-xl font-semibold tabular-nums`} placeholder="0.00" />
        </div>

        <div>
          <label className={labelClass}>Tara</label>
          <div role="group" aria-label="Modo de tara" className="mb-2 inline-flex overflow-hidden rounded-lg border border-border text-sm">
            <button type="button" aria-pressed={campoTara.taraModo === 'preconfigurada'} onClick={() => setCampoTara(prev => ({ ...prev, taraModo: 'preconfigurada' }))} className={`min-h-11 px-4 py-2 ${campoTara.taraModo === 'preconfigurada' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
              Preconfigurada
            </button>
            <button type="button" aria-pressed={campoTara.taraModo === 'manual'} onClick={() => setCampoTara(prev => ({ ...prev, taraModo: 'manual' }))} className={`min-h-11 px-4 py-2 ${campoTara.taraModo === 'manual' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
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
                  <ChevronDown size={16} className="text-text-muted shrink-0" />
                </button>
                <CantidadTaraInput value={campoTara.taraCantidad} onChange={v => setCampoTara(prev => ({ ...prev, taraCantidad: v }))} />
              </div>
              <p className="text-xs text-text-secondary mt-1">= {fmt(taraKgFila(campoTara, taras))} kg</p>
            </div>
          ) : (
            <input type="number" inputMode="decimal" step="0.001" min="0" value={campoTara.taraManual} onChange={e => setCampoTara(prev => ({ ...prev, taraManual: e.target.value }))} className={inputClass} placeholder="0.00" aria-label="Tara manual en kilos" />
          )}
        </div>

        {pesoBruto !== '' && netoActual >= 0 && (
          <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-text-secondary" aria-live="polite">
            Neto a registrar: <span className="text-2xl font-bold tabular-nums text-text-primary">{fmt(netoActual)}</span> <span className="font-medium">kg</span>
          </p>
        )}

        {composicionProyectada && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5">
            <p className="text-[11px] font-medium text-blue-800 mb-1.5">
              Composición estimada del lote después de registrar este pesaje:
            </p>
            <div className="flex flex-wrap gap-1">
              {composicionProyectada.map(c => (
                <span key={c.item} className="text-[11px] bg-white text-blue-700 border border-blue-200 rounded-full px-2 py-0.5">
                  {c.item} · ~{fmt(c.kg)} kg
                </span>
              ))}
            </div>
          </div>
        )}

        <FotoMaterialPicker fotos={fotos} onAgregar={agregarFotos} onQuitar={quitarFoto} label="Fotos" />

        {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}

        <button type="submit" disabled={guardando} className="w-full min-h-12 py-3 bg-brand-600 text-white rounded-lg text-base font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2">
          {guardando ? 'Registrando…' : 'Agregar pesaje'}
        </button>
      </form>
      </Bloque>

      <Bloque
        titulo={`Pesajes registrados (${detalle.length})`}
        queEstasViendo={detalle.length > 0 ? `Lo que ya pesaste en esta toma: ${fmt(totalNeto)} kg netos en total (peso sin envase). Si te equivocaste, quita el pesaje con la papelera.` : 'Aquí aparecerán los pesajes que vayas agregando a esta toma.'}
      >
        {detalle.length === 0 ? (
          <EstadoVacio
            mensaje="Todavía no registraste ningún pesaje."
            descripcion="Elige un material de la lista de arriba, pesa y toca Agregar pesaje: aparecerá aquí con su foto."
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {detalle.map(d => {
              const label = d.nombreProducto
                ? `${d.nombreProducto}${d.nombreLote ? ` · ${d.nombreLote}` : ''}`
                : `${d.nombreLote ?? '—'} (lote completo)`;
              return (
                <li key={d.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    {d.nombreProducto ? (
                      <>
                        <span className="text-text-primary">{d.nombreProducto}</span>
                        {d.nombreLote && <span className="text-text-secondary"> · {d.nombreLote}</span>}
                      </>
                    ) : (
                      <span className="text-text-primary">{d.nombreLote ?? '—'} (lote completo)</span>
                    )}
                  </div>
                  <span className="shrink-0 font-semibold tabular-nums text-text-primary">{fmt(d.pesoNeto)} kg</span>
                  {d.fotos.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setGaleriaAbierta({ label, fotos: d.fotos })}
                      className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg text-text-secondary hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                      title="Ver fotos"
                      aria-label={`Ver ${d.fotos.length} foto${d.fotos.length === 1 ? '' : 's'} de ${label}`}
                    >
                      <Images size={16} />
                      <span className="text-xs">{d.fotos.length}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleQuitar(d.id)}
                    className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-text-secondary hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                    title="Quitar"
                    aria-label={`Quitar el pesaje de ${label}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Bloque>

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

      {galeriaAbierta && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setGaleriaAbierta(null)}>
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-sm font-semibold text-text-primary truncate">{galeriaAbierta.label}</h2>
              <button type="button" onClick={() => setGaleriaAbierta(null)} className="text-text-muted hover:text-text-primary transition-colors shrink-0">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 grid grid-cols-3 gap-2">
              {galeriaAbierta.fotos.map((url, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setFotoAmpliada(url)}
                  className="group relative aspect-square rounded-lg overflow-hidden border border-border"
                  title="Ver foto en grande"
                >
                  <img src={url} alt={`Foto ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
                    <ZoomIn size={16} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {fotoAmpliada && (
        <VisorFotos
          fotos={galeriaAbierta?.fotos ?? [fotoAmpliada]}
          indice={Math.max(0, (galeriaAbierta?.fotos ?? [fotoAmpliada]).indexOf(fotoAmpliada))}
          onCambiar={i => setFotoAmpliada((galeriaAbierta?.fotos ?? [fotoAmpliada])[i])}
          onCerrar={() => setFotoAmpliada(null)}
        />
      )}
    </div>
  );
}

export default ConteoTomaFisicaPage;
