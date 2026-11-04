import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { AlertTriangle, CircleDashed, Loader2, Lock, PencilLine, Receipt, Search, X } from 'lucide-react';
import type { CostosInventario } from '@shared/types/inventario-pantalla.js';
import { obtenerCostosInventario, guardarCostosInventario } from '../../../services/inventario-pantalla-service';
import { useToast } from '../../../hooks/use-toast-context';
import { useBorradorPersistente } from '../../../hooks/use-borrador-persistente';
import AvisoBorrador from '../../../components/AvisoBorrador';
import { Chip, EstadoVacio, InfoTooltip, SkeletonTabla, formatearKg, formatearNumero, formatearUsd } from '../../../components/ui';
import { estiloCategoria } from '../../../lib/colores-categoria';
import {
  agruparPorCategoria,
  aplicarCostoACategoria,
  calcularTotales,
  editarCosto,
  estadoFila,
  filasDeCategoriaAfectadas,
  filtrarFilas,
  itemsParaGuardar,
  parsearCosto,
  quitarCostoManual,
  type Ediciones,
  type FilaCosto,
} from '../../../lib/inventario-costos';

/** Panel/modal "Costos del inventario": el dueño pone a mano el costo por kg de cada producto para ver el valor estimado a
 *  costo de todo el inventario. Lógica de cálculo en lib/inventario-costos.ts (pura y probada). */

export interface CostosEditorPanelProps {
  abierto: boolean;
  onCerrar: () => void;
  onGuardado: () => void;
  productoEnfocadoId?: string | null;
  puedeEditar: boolean;
}

const UMBRAL_PAGINAR = 150;
const TAMANO_PAGINA = 100;
const ENFOCABLES = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const TEXTO_COSTO_MANUAL = 'Costo manual: precio por kg que tú pones; manda sobre el promedio de facturas. Quítalo para volver al promedio de las facturas de compra.';
const TEXTO_SOLO_LECTURA = 'Estás en modo solo lectura: necesitas permiso de facturación para editar los costos.';

type Carga =
  | { estado: 'cargando' }
  | { estado: 'error'; mensaje: string }
  | { estado: 'ok'; datos: CostosInventario };

/** Los servicios pueden devolver el dato directo o { dato } | { error }: acepta ambos. */
function desempaquetar(r: unknown): { dato: CostosInventario } | { error: string } {
  if (r && typeof r === 'object') {
    const o = r as Record<string, unknown>;
    if (typeof o.error === 'string') return { error: o.error };
    if ('dato' in o && o.dato) return { dato: o.dato as CostosInventario };
    if (Array.isArray(o.productos)) return { dato: r as CostosInventario };
  }
  return { error: 'La respuesta del servidor no tiene el formato esperado.' };
}

function mensajeDe(err: unknown, porDefecto: string): string {
  return err instanceof Error && err.message ? err.message : porDefecto;
}

// ---- Fila -----------------------------------------------------------------------------------------------------------------

interface FilaProps {
  fila: FilaCosto;
  edicion: string | undefined;
  puedeEditar: boolean;
  resaltada: boolean;
  onCambiar: (fila: FilaCosto, texto: string) => void;
  onQuitar: (fila: FilaCosto) => void;
}

function InsigniaFuente({ fuente }: { fuente: 'manual' | 'facturas' | null }) {
  if (fuente === 'manual') {
    return <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-800"><PencilLine size={12} aria-hidden="true" />Manual</span>;
  }
  if (fuente === 'facturas') {
    return <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface-alt px-2 py-0.5 text-xs font-medium text-text-secondary"><Receipt size={12} aria-hidden="true" />Facturas</span>;
  }
  return <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"><CircleDashed size={12} aria-hidden="true" />Sin costo</span>;
}

const FilaCostoItem = memo(function FilaCostoItem({ fila, edicion, puedeEditar, resaltada, onCambiar, onQuitar }: FilaProps) {
  const ids = useId();
  const est = estadoFila(fila, edicion === undefined ? {} : { [fila.productoId]: edicion });
  const idAyuda = `${ids}-ayuda`;
  const idError = `${ids}-error`;
  return (
    <li
      id={`costo-fila-${fila.productoId}`}
      className={`rounded-lg border bg-surface p-3 ${resaltada ? 'ring-2 ring-brand-400' : ''} ${est.modificado ? 'border-brand-400' : 'border-border'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 break-words text-sm font-semibold text-text-primary">{fila.nombre}</p>
        <div className="flex shrink-0 items-center gap-1.5">
          {est.modificado && <span className="text-xs font-medium text-brand-800"><span aria-hidden="true">● </span>Cambiado</span>}
          <InsigniaFuente fuente={est.fuente} />
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-text-muted">Kilos en existencia</dt>
          <dd className="text-sm tabular-nums text-text-primary">{formatearKg(fila.kg)}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Costo de facturas $/kg</dt>
          <dd className="text-sm tabular-nums text-text-primary">{fila.costoFacturasKg === null ? <span className="text-text-muted">— (sin facturas)</span> : `USD ${formatearNumero(fila.costoFacturasKg, 2)}`}</dd>
        </div>
        <div className="col-span-2 sm:col-span-1 sm:order-last">
          <dt className="text-xs text-text-muted">Valor estimado de la fila</dt>
          <dd className="text-sm font-semibold tabular-nums text-text-primary">{est.valorUsd === null ? <span className="font-normal text-text-muted">— (falta costo)</span> : formatearUsd(est.valorUsd)}</dd>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <dt><label htmlFor={`costo-input-${fila.productoId}`} className="text-xs text-text-muted">Mi costo por kg (USD)</label></dt>
          <dd>
            <div className="flex items-center gap-2">
              <input
                id={`costo-input-${fila.productoId}`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={est.texto}
                disabled={!puedeEditar}
                placeholder={puedeEditar ? 'Ej. 12,5' : '—'}
                onChange={e => onCambiar(fila, e.target.value)}
                aria-invalid={est.error ? true : undefined}
                aria-describedby={est.error ? idError : idAyuda}
                className={`w-28 rounded-lg border bg-surface-alt px-2.5 py-1.5 text-sm tabular-nums text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-60 ${est.error ? 'border-red-400' : 'border-border'}`}
              />
              {puedeEditar && est.tieneManual && (
                <button
                  type="button"
                  onClick={() => onQuitar(fila)}
                  aria-label={`Quitar costo manual de ${fila.nombre}`}
                  className="rounded text-xs font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  Quitar costo manual
                </button>
              )}
            </div>
            {est.error
              ? <p id={idError} role="alert" className="mt-1 text-xs text-red-700"><span aria-hidden="true">✕ </span>{est.error}</p>
              : <p id={idAyuda} className="sr-only">Escribe el costo en dólares por kilo. Puedes usar coma o punto. Déjalo vacío para usar el promedio de facturas.</p>}
          </dd>
        </div>
      </dl>
    </li>
  );
});

// ---- Panel principal ----------------------------------------------------------------------------------------------------------

interface PanelCategoria { clave: string; texto: string; soloSinCosto: boolean }

export default function CostosEditorPanel({ abierto, onCerrar, onGuardado, productoEnfocadoId, puedeEditar }: CostosEditorPanelProps) {
  const toast = useToast();
  const tituloId = useId();
  const introId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [carga, setCarga] = useState<Carga>({ estado: 'cargando' });
  const [intento, setIntento] = useState(0);
  const [ediciones, setEdiciones] = useState<Ediciones>({});
  const [busqueda, setBusqueda] = useState('');
  const [soloSinCosto, setSoloSinCosto] = useState(false);
  const [soloConCambios, setSoloConCambios] = useState(false);
  const [limite, setLimite] = useState(TAMANO_PAGINA);
  const [panelCategoria, setPanelCategoria] = useState<PanelCategoria | null>(null);
  const [confirmandoCierre, setConfirmandoCierre] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState('');
  const enfocadoHecho = useRef(false);
  const [resaltado, setResaltado] = useState<string | null>(null);
  const [enfocadoListo, setEnfocadoListo] = useState(false);

  const datos = carga.estado === 'ok' ? carga.datos : null;
  const filas = useMemo<FilaCosto[]>(() => (datos ? (datos.productos as FilaCosto[]) : []), [datos]);
  const hayCambios = Object.keys(ediciones).length > 0;

  // ---- Carga de datos (cada vez que se abre) ----
  // Al abrir o reintentar se vuelve a "cargando" durante el render (no dentro del efecto), sin mostrar datos viejos.
  const claveCarga = abierto ? `a${intento}` : null;
  const [claveCargaVista, setClaveCargaVista] = useState(claveCarga);
  if (claveCarga !== claveCargaVista) {
    setClaveCargaVista(claveCarga);
    if (claveCarga) setCarga({ estado: 'cargando' });
  }
  useEffect(() => {
    if (!abierto) return;
    let cancelado = false;
    obtenerCostosInventario()
      .then(r => {
        if (cancelado) return;
        const d = desempaquetar(r);
        setCarga('error' in d ? { estado: 'error', mensaje: d.error } : { estado: 'ok', datos: d.dato });
      })
      .catch(err => { if (!cancelado) setCarga({ estado: 'error', mensaje: mensajeDe(err, 'No se pudieron cargar los costos de los productos.') }); });
    return () => { cancelado = true; };
  }, [abierto, intento]);

  // ---- Borrador persistente (sobrevive a F5) ----
  const estadoBorrador = { ediciones };
  const borrador = useBorradorPersistente<typeof estadoBorrador>({
    formulario: 'inventario-costos',
    version: 1,
    estado: estadoBorrador,
    hayCambios,
    habilitado: abierto && puedeEditar && carga.estado === 'ok',
    aplicar: d => {
      const ids = new Set(filas.map(f => f.productoId));
      const validas = Object.fromEntries(Object.entries(d.ediciones ?? {}).filter(([id, t]) => ids.has(id) && typeof t === 'string'));
      setEdiciones(validas);
    },
    restablecer: () => setEdiciones({}),
  });

  // ---- Cierre ----
  const cerrarDefinitivo = useCallback(() => {
    borrador.limpiar();
    setEdiciones({});
    setBusqueda(''); setSoloSinCosto(false); setSoloConCambios(false);
    setPanelCategoria(null); setConfirmandoCierre(false); setErrorGuardar(null);
    onCerrar();
  }, [borrador, onCerrar]);

  const solicitarCierre = useCallback(() => {
    if (guardando) return;
    if (hayCambios) setConfirmandoCierre(true);
    else cerrarDefinitivo();
  }, [guardando, hayCambios, cerrarDefinitivo]);

  // ---- Foco: al abrir, atrapado dentro, y se devuelve al cerrar ----
  useEffect(() => {
    if (!abierto) return;
    const previo = document.activeElement as HTMLElement | null;
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = overflowPrevio;
      previo?.focus?.();
      enfocadoHecho.current = false;
      setEnfocadoListo(false);
    };
  }, [abierto]);

  const alTeclear = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      if (dialogRef.current?.querySelector('[role="tooltip"]')) return; // el "?" abierto se cierra solo con Escape
      e.stopPropagation();
      if (confirmandoCierre) setConfirmandoCierre(false);
      else if (panelCategoria) setPanelCategoria(null);
      else solicitarCierre();
      return;
    }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const lista = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(ENFOCABLES)).filter(el => el.offsetParent !== null);
    if (lista.length === 0) { e.preventDefault(); return; }
    const primero = lista[0];
    const ultimo = lista[lista.length - 1];
    const activo = document.activeElement;
    if (e.shiftKey && (activo === primero || activo === dialogRef.current)) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && activo === ultimo) { e.preventDefault(); primero.focus(); }
  };

  // ---- Lista filtrada, agrupada y paginada ----
  const filtradas = useMemo(() => filtrarFilas(filas, ediciones, { busqueda, soloSinCosto, soloConCambios }), [filas, ediciones, busqueda, soloSinCosto, soloConCambios]);
  const grupos = useMemo(() => agruparPorCategoria(filtradas), [filtradas]);
  const totales = useMemo(() => calcularTotales(filas, ediciones), [filas, ediciones]);
  const paginar = filtradas.length > UMBRAL_PAGINAR;
  // Producto pedido al abrir: si queda más allá de la página actual, se muestra hasta él (y se fija en el límite al enfocarlo).
  const existeEnfocado = !!productoEnfocadoId && filas.some(f => f.productoId === productoEnfocadoId);
  const posicionEnfocado = useMemo(
    () => (existeEnfocado ? grupos.flatMap(g => g.filas).findIndex(f => f.productoId === productoEnfocadoId) : -1),
    [existeEnfocado, grupos, productoEnfocadoId],
  );
  const limiteEfectivo = !enfocadoListo && posicionEnfocado >= limite ? posicionEnfocado + 20 : limite;
  const maximo = paginar ? limiteEfectivo : filtradas.length;

  const gruposVisibles = useMemo(() => {
    const salida: Array<(typeof grupos)[number] & { visibles: FilaCosto[] }> = [];
    let restante = maximo;
    for (const g of grupos) {
      if (restante <= 0) break;
      const visibles = g.filas.slice(0, restante);
      restante -= visibles.length;
      if (visibles.length > 0) salida.push({ ...g, visibles });
    }
    return salida;
  }, [grupos, maximo]);

  // Al cambiar un filtro se vuelve a la primera página (durante el render, no en un efecto).
  const claveFiltros = `${busqueda}|${soloSinCosto}|${soloConCambios}`;
  const [claveFiltrosVista, setClaveFiltrosVista] = useState(claveFiltros);
  if (claveFiltros !== claveFiltrosVista) {
    setClaveFiltrosVista(claveFiltros);
    setLimite(TAMANO_PAGINA);
  }

  // ---- Enfocar el producto pedido al abrir ----
  useEffect(() => {
    if (!abierto || !datos || !productoEnfocadoId || enfocadoHecho.current || !existeEnfocado) return;
    enfocadoHecho.current = true;
    const t = window.setTimeout(() => {
      setLimite(prev => (posicionEnfocado >= prev ? posicionEnfocado + 20 : prev));
      setEnfocadoListo(true);
      document.getElementById(`costo-fila-${productoEnfocadoId}`)?.scrollIntoView({ block: 'center' });
      document.getElementById(`costo-input-${productoEnfocadoId}`)?.focus({ preventScroll: true });
      setResaltado(productoEnfocadoId);
    }, 50);
    return () => window.clearTimeout(t);
  }, [abierto, datos, productoEnfocadoId, existeEnfocado, posicionEnfocado]);

  // ---- Acciones ----
  const cambiar = useCallback((fila: FilaCosto, texto: string) => {
    setEdiciones(prev => editarCosto(prev, fila, texto));
    setErrorGuardar(null);
  }, []);
  const quitar = useCallback((fila: FilaCosto) => {
    setEdiciones(prev => quitarCostoManual(prev, fila));
    setErrorGuardar(null);
  }, []);

  const afectadas = useMemo(
    () => (panelCategoria ? filasDeCategoriaAfectadas(filas, ediciones, panelCategoria.clave, panelCategoria.soloSinCosto) : []),
    [panelCategoria, filas, ediciones],
  );
  const parseoPanel = panelCategoria ? parsearCosto(panelCategoria.texto) : null;
  const panelValido = !!parseoPanel && parseoPanel.ok && parseoPanel.valor !== null;

  const aplicarCategoria = () => {
    if (!panelCategoria || !panelValido) return;
    setEdiciones(prev => aplicarCostoACategoria(filas, prev, panelCategoria.clave, panelCategoria.texto, panelCategoria.soloSinCosto));
    setAnuncio(`Costo aplicado a ${afectadas.length} productos. Revisa los cambios y pulsa Guardar cambios.`);
    setPanelCategoria(null);
  };

  const guardar = async () => {
    if (guardando || !puedeEditar) return;
    if (totales.invalidos > 0) { setErrorGuardar('Hay costos con errores (marcados en rojo). Corrígelos para poder guardar.'); return; }
    const items = itemsParaGuardar(filas, ediciones);
    if (items.length === 0) { cerrarDefinitivo(); return; }
    setGuardando(true);
    setErrorGuardar(null);
    try {
      const r = desempaquetar(await guardarCostosInventario(items));
      if ('error' in r) { setErrorGuardar(r.error); return; }
      toast.exito(items.length === 1 ? 'Se guardó 1 costo.' : `Se guardaron ${items.length} costos.`);
      onGuardado();
      cerrarDefinitivo();
    } catch (err) {
      setErrorGuardar(mensajeDe(err, 'No se pudieron guardar los costos. Revisa tu conexión e inténtalo de nuevo.'));
    } finally {
      setGuardando(false);
    }
  };

  if (!abierto) return null;

  const hayFiltros = busqueda !== '' || soloSinCosto || soloConCambios;
  const quitarFiltros = () => { setBusqueda(''); setSoloSinCosto(false); setSoloConCambios(false); };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={e => { if (e.target === e.currentTarget) solicitarCierre(); }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        aria-describedby={introId}
        tabIndex={-1}
        onKeyDown={alTeclear}
        className="flex h-[100dvh] w-full flex-col overflow-hidden bg-surface shadow-xl focus:outline-none sm:h-auto sm:max-h-[90vh] sm:max-w-4xl sm:rounded-2xl"
      >
        {/* Encabezado */}
        <div className="flex items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
          <div className="min-w-0">
            <h2 id={tituloId} className="text-lg font-bold text-text-primary">Costos para el valor del inventario</h2>
            <p id={introId} className="mt-1 text-sm text-text-secondary">
              {puedeEditar
                ? 'Aquí pones a mano cuánto cuesta cada kilo de cada producto, para ver cuánto vale a costo todo lo que tienes en existencia. Si no pones nada, se usa el promedio de tus facturas de compra.'
                : 'Aquí se ve cuánto cuesta cada kilo de cada producto y de dónde sale ese costo (puesto a mano o promedio de las facturas de compra). Solo consulta: tu usuario no puede cambiar costos.'}
            </p>
            <p className="mt-1 hidden text-xs text-text-muted sm:block">{TEXTO_COSTO_MANUAL}</p>
          </div>
          <button type="button" onClick={solicitarCierre} aria-label="Cerrar el editor de costos" className="shrink-0 rounded-lg p-1.5 text-text-muted hover:bg-surface-hover hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Totales en vivo */}
        {datos && (
          <div className="grid grid-cols-1 gap-1.5 border-b border-border bg-surface-alt/60 px-4 py-3 sm:grid-cols-3 sm:gap-3 sm:px-5" aria-label="Totales con tus cambios">
            <div className="flex items-center justify-between gap-2 sm:block">
              <div className="flex items-center gap-1 text-xs text-text-muted">
                Valor estimado a costo (con tus cambios)
                <InfoTooltip etiqueta="Qué significa: valor estimado a costo">
                  Kilos de cada producto por su costo por kg, sumados, incluyendo los cambios que aún no has guardado. {TEXTO_COSTO_MANUAL}
                </InfoTooltip>
              </div>
              <p className="text-lg font-bold tabular-nums text-text-primary">{totales.valorUsd === null ? '—' : formatearUsd(totales.valorUsd)}</p>
            </div>
            <div className="flex items-center justify-between gap-2 sm:block">
              <div className="flex items-center gap-1 text-xs text-text-muted">
                Kilos sin costo
                <InfoTooltip etiqueta="Qué significa: kilos sin costo">Kilos de productos que todavía no tienen ni costo manual ni promedio de facturas. No suman al valor estimado.</InfoTooltip>
              </div>
              <p className="text-lg font-bold tabular-nums text-text-primary">{formatearKg(totales.kgSinCosto)}</p>
            </div>
            <div className="flex items-center justify-between gap-2 sm:block">
              <div className="flex items-center gap-1 text-xs text-text-muted">
                Productos sin costo
                <InfoTooltip etiqueta="Qué significa: productos sin costo">Cantidad de productos con kilos en existencia a los que aún les falta el costo por kg.</InfoTooltip>
              </div>
              <p className="text-lg font-bold tabular-nums text-text-primary">{formatearNumero(totales.productosSinCosto)} <span className="text-sm font-normal text-text-muted">de {formatearNumero(filas.length)}</span></p>
            </div>
          </div>
        )}

        {/* Cuerpo desplazable */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-3 p-4 sm:p-5">
            {!puedeEditar && (
              <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-text-secondary">
                <Lock size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{TEXTO_SOLO_LECTURA}
              </p>
            )}
            {puedeEditar && <AvisoBorrador formulario="costos por kg" aviso={borrador.aviso} onDescartar={borrador.descartar} onCerrar={borrador.cerrarAviso} />}
            <p className="sr-only" role="status" aria-live="polite">{anuncio}</p>

            {carga.estado === 'cargando' && <div role="status" aria-label="Cargando costos"><SkeletonTabla filas={6} columnas={4} /></div>}

            {carga.estado === 'error' && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                <p className="flex items-start gap-2 font-medium"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />No se pudieron cargar los costos.</p>
                <p className="mt-1 text-xs">{carga.mensaje}</p>
                <button type="button" onClick={() => setIntento(n => n + 1)} className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">Reintentar</button>
              </div>
            )}

            {datos && filas.length === 0 && (
              <EstadoVacio
                mensaje="No hay productos con kilos en existencia"
                descripcion="Cuando haya stock registrado (por una toma física o por recepciones de material) los productos aparecerán aquí para que les pongas costo."
                accion={{ etiqueta: 'Cerrar', onClick: solicitarCierre }}
              />
            )}

            {datos && filas.length > 0 && (
              <>
                {productoEnfocadoId && !existeEnfocado && (
                  <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">El producto que elegiste no tiene kilos en existencia, por eso no aparece en esta lista.</p>
                )}

                {/* Buscador y filtros */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[12rem] flex-1">
                    <Search size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" />
                    <input
                      type="search"
                      value={busqueda}
                      onChange={e => setBusqueda(e.target.value)}
                      aria-label="Buscar producto o categoría"
                      placeholder="Buscar producto o categoría"
                      className="w-full rounded-lg border border-border bg-surface-alt py-2 pl-8 pr-3 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                    />
                  </div>
                  <Chip onClick={() => setSoloSinCosto(v => !v)} seleccionado={soloSinCosto}>Solo sin costo</Chip>
                  <Chip onClick={() => setSoloConCambios(v => !v)} seleccionado={soloConCambios}>Solo con cambios</Chip>
                </div>
                <p className="text-xs text-text-muted" aria-live="polite">
                  Mostrando {formatearNumero(filtradas.length)} de {formatearNumero(filas.length)} productos.
                  {soloSinCosto && ' “Solo sin costo” usa el costo ya guardado, así la fila no desaparece mientras escribes.'}
                </p>

                {filtradas.length === 0 && (
                  <EstadoVacio
                    mensaje="Ningún producto coincide con lo que buscas"
                    descripcion={soloConCambios && !busqueda && !soloSinCosto ? 'Todavía no has cambiado ningún costo.' : 'Prueba con otra palabra o quita los filtros.'}
                    accion={hayFiltros ? { etiqueta: 'Quitar filtros', onClick: quitarFiltros } : undefined}
                  />
                )}

                {gruposVisibles.map(g => {
                  const estilo = estiloCategoria(g.categoria);
                  const abiertoPanel = panelCategoria?.clave === g.categoriaClave;
                  return (
                    <section key={g.categoriaClave} aria-label={`Categoría ${g.categoria}`} className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-1.5" style={{ backgroundColor: estilo.fondo }}>
                        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
                          <span aria-hidden="true" style={{ color: estilo.color }}>{estilo.simbolo}</span>
                          {g.categoria}
                          <span className="text-xs font-normal text-text-secondary">({formatearNumero(g.filas.length)})</span>
                        </h3>
                        {puedeEditar && !abiertoPanel && (
                          <button
                            type="button"
                            onClick={() => setPanelCategoria({ clave: g.categoriaClave, texto: '', soloSinCosto: true })}
                            className="rounded text-xs font-medium text-brand-800 underline underline-offset-2 hover:text-brand-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                          >
                            Aplicar el mismo costo a todos los de esta categoría
                          </button>
                        )}
                      </div>

                      {abiertoPanel && panelCategoria && (
                        <div role="group" aria-label={`Aplicar el mismo costo en ${g.categoria}`} className="space-y-2 rounded-lg border border-brand-300 bg-brand-50/60 p-3">
                          <div className="flex flex-wrap items-end gap-3">
                            <label className="text-xs text-text-secondary">
                              Costo por kg para toda la categoría {g.categoria} (USD)
                              <input
                                type="text"
                                inputMode="decimal"
                                autoComplete="off"
                                autoFocus
                                value={panelCategoria.texto}
                                onChange={e => setPanelCategoria({ ...panelCategoria, texto: e.target.value })}
                                placeholder="Ej. 12,5"
                                aria-invalid={parseoPanel && !parseoPanel.ok ? true : undefined}
                                className="mt-1 block w-32 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm tabular-nums text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                              />
                            </label>
                            <label className="flex items-center gap-2 text-xs text-text-secondary">
                              <input
                                type="checkbox"
                                checked={panelCategoria.soloSinCosto}
                                onChange={e => setPanelCategoria({ ...panelCategoria, soloSinCosto: e.target.checked })}
                                className="h-4 w-4 accent-brand-600"
                              />
                              Solo a los que no tienen costo
                            </label>
                          </div>
                          {parseoPanel && !parseoPanel.ok && <p role="alert" className="text-xs text-red-700"><span aria-hidden="true">✕ </span>{parseoPanel.error}</p>}
                          <p className="text-sm text-text-primary" aria-live="polite">
                            {panelValido
                              ? <>Se pondrá <strong>USD {formatearNumero((parseoPanel as { valor: number }).valor, 2)} por kg</strong> a <strong>{formatearNumero(afectadas.length)} {afectadas.length === 1 ? 'producto' : 'productos'}</strong> de {g.categoria}{panelCategoria.soloSinCosto ? ' que no tienen ningún costo' : ' (también reemplaza costos que ya tenían)'}. Podrás revisarlo antes de guardar.</>
                              : 'Escribe el costo por kg para ver a cuántos productos se aplicaría.'}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={aplicarCategoria} disabled={!panelValido || afectadas.length === 0} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-50">
                              Aplicar a {formatearNumero(afectadas.length)} {afectadas.length === 1 ? 'producto' : 'productos'}
                            </button>
                            <button type="button" onClick={() => setPanelCategoria(null)} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">Cancelar</button>
                          </div>
                        </div>
                      )}

                      <ul className="space-y-2">
                        {g.visibles.map(f => (
                          <FilaCostoItem
                            key={f.productoId}
                            fila={f}
                            edicion={ediciones[f.productoId]}
                            puedeEditar={puedeEditar}
                            resaltada={resaltado === f.productoId}
                            onCambiar={cambiar}
                            onQuitar={quitar}
                          />
                        ))}
                      </ul>
                    </section>
                  );
                })}

                {paginar && maximo < filtradas.length && (
                  <div className="text-center">
                    <button type="button" onClick={() => setLimite(n => n + TAMANO_PAGINA)} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                      Mostrar {formatearNumero(Math.min(TAMANO_PAGINA, filtradas.length - maximo))} más (quedan {formatearNumero(filtradas.length - maximo)})
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Pie */}
        <div className="space-y-2 border-t border-border bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
          {confirmandoCierre && (
            <div role="alertdialog" aria-label="Cambios sin guardar" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="flex items-center gap-2"><AlertTriangle size={16} aria-hidden="true" />Tienes {formatearNumero(totales.cambios)} {totales.cambios === 1 ? 'cambio' : 'cambios'} sin guardar. Si cierras, se pierden.</span>
              <span className="flex gap-2">
                <button type="button" autoFocus onClick={() => setConfirmandoCierre(false)} className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">Seguir editando</button>
                <button type="button" onClick={cerrarDefinitivo} className="rounded-lg bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">Descartar y cerrar</button>
              </span>
            </div>
          )}
          {errorGuardar && (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>No se guardó: {errorGuardar} Tus cambios siguen aquí; pulsa “Reintentar guardado”.</span>
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-text-muted" aria-live="polite">
              {puedeEditar
                ? (totales.cambios > 0 ? `${formatearNumero(totales.cambios)} ${totales.cambios === 1 ? 'cambio' : 'cambios'} sin guardar` : 'Sin cambios')
                : 'Solo lectura'}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={solicitarCierre} disabled={guardando} className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50">
                {puedeEditar ? 'Cancelar' : 'Cerrar'}
              </button>
              {puedeEditar && (
                <button
                  type="button"
                  onClick={guardar}
                  disabled={guardando || carga.estado !== 'ok' || totales.cambios === 0}
                  className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {guardando && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                  {guardando ? 'Guardando…' : errorGuardar ? 'Reintentar guardado' : 'Guardar cambios'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

