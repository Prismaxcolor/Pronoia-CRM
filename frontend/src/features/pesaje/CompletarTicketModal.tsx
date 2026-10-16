import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Plus, Trash2, Loader2, Scale, ChevronDown } from 'lucide-react';
import { completarTicket, cuerpoCompletarTicket, obtenerTickets } from '../../services/ticket-pesaje-service';
import { iniciarEnvio, enviarOEncolar } from './pesaje-envio';
import { mensajeGuardadoEnTelefono } from '../../lib/offline/cola-guardado';
import { useToast } from '../../hooks/use-toast-context';
import { useBorradorPersistente } from '../../hooks/use-borrador-persistente';
import AvisoBorrador from '../../components/AvisoBorrador';
import { difiereEstado } from '../../lib/borrador';
import { intersectarIds, mensajeReseteos, mensajeSaneoBorrador, sanearFilasRestauradas } from '../../lib/borrador-vigentes';
import { filaVacia, filasDesdeBorrador, taraFilaNoVigente, MENSAJE_TARA_NO_VIGENTE, taraKgFila, netoFila, materialAPayload, esFilaSinLote, loteIdsPosiblesFila, seleccionarTaraFila, type MaterialFila, type FotoMaterial } from './material-fila';
import { diferenciaFavoreceProveedor, colorClaseDiferencia, calcularDiferenciaPeso, redondearKg, descripcionDiferencia } from './diferencia-peso';
import FotoMaterialPicker from './FotoMaterialPicker';
import SeleccionarMaterialModal from './SeleccionarMaterialModal';
import SelectorDestinoLote from './SelectorDestinoLote';
import SeleccionarTaraModal from './SeleccionarTaraModal';
import CantidadTaraInput from './CantidadTaraInput';
import TarasExtraEditor from './TarasExtraEditor';
import { filaTaraIncompleta } from './tara-multiple';
import type { Producto, TicketPesaje, Lote, Tara } from '@shared/types/index.js';

interface Props {
  ticket: TicketPesaje;
  productos: Producto[];
  lotes: Lote[];
  taras: Tara[];
  onClose: () => void;
  onCompletado: () => void;
}

/** Suma el peso global del ticket principal con el de los tickets unidos seleccionados. */
function pesoGlobalTotal(pesoPrincipal: number, unidos: ReadonlyArray<{ pesoGlobal: number }>): number {
  return redondearKg(unidos.reduce((acc, t) => acc + t.pesoGlobal, pesoPrincipal));
}

const MAX_NOTAS = 1000;

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

function CompletarTicketModal({ ticket, productos, lotes, taras, onClose, onCompletado }: Props) {
  const toast = useToast();
  const [materiales, setMateriales] = useState<MaterialFila[]>([filaVacia()]);
  const [devolucion, setDevolucion] = useState('');
  const [notas, setNotas] = useState('');
  const [fotosDevolucion, setFotosDevolucion] = useState<FotoMaterial[]>([]);
  const [guardando, setGuardando] = useState(false);
  // Id de la operación en curso: se conserva si el envío falla para que un reintento no duplique.
  const idEnvioRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filaActivaUid, setFilaActivaUid] = useState<number | null>(null);
  const [mostrarSelectorMaterial, setMostrarSelectorMaterial] = useState(false);
  const [mostrarSelectorTara, setMostrarSelectorTara] = useState(false);
  const [candidatos, setCandidatos] = useState<TicketPesaje[]>([]);
  const [unidosIds, setUnidosIds] = useState<string[]>([]);
  const [avisoSaneo, setAvisoSaneo] = useState<string | null>(null);
  const unidosRef = useRef<string[]>([]);
  useEffect(() => { unidosRef.current = unidosIds; });

  const estadoBorrador = { materiales, devolucion, notas, fotosDevolucion, unidosIds };
  const restablecer = () => {
    setMateriales([filaVacia()]);
    setDevolucion('');
    setNotas('');
    setFotosDevolucion([]);
    setUnidosIds([]);
    setAvisoSaneo(null);
  };
  const borrador = useBorradorPersistente<typeof estadoBorrador>({
    formulario: 'completar-ticket',
    docId: ticket.id,
    version: 1,
    estado: estadoBorrador,
    // Sin catálogos cargados no se puede validar el borrador: se espera a tenerlos.
    habilitado: productos.length > 0,
    hayCambios: difiereEstado(estadoBorrador, { materiales: [filaVacia()], devolucion: '', notas: '', fotosDevolucion: [], unidosIds: [] }),
    aplicar: d => {
      // Material, lote o tara que ya no existen (o se desactivaron) quedan sin elegir, con aviso.
      const saneo = sanearFilasRestauradas(filasDesdeBorrador(d.materiales), {
        productoIds: productos.map(p => p.id),
        loteIds: lotes.map(l => l.id),
        taraIds: taras.filter(t => t.activo).map(t => t.id),
      });
      const texto = mensajeReseteos(saneo.reseteos);
      setAvisoSaneo(texto ? mensajeSaneoBorrador([texto]) : null);
      setMateriales(saneo.filas);
      setDevolucion(d.devolucion ?? '');
      setNotas(d.notas ?? '');
      setFotosDevolucion(d.fotosDevolucion ?? []);
      setUnidosIds(d.unidosIds ?? []);
    },
    restablecer,
  });
  // Cerrar (X, Cancelar o tras completar) descarta el borrador guardado.
  const cerrar = () => { borrador.limpiar(); onClose(); };

  const puedeUnir = ticket.tipo === 'compra' && !!ticket.entidadId && !ticket.pesajeExterior;

  // Otros tickets en bruto del mismo proveedor (opcional: si no hay, no se muestra nada).
  useEffect(() => {
    if (!puedeUnir || !ticket.entidadId) return;
    let activo = true;
    obtenerTickets({ tipo: 'compra', entidadId: ticket.entidadId, estado: 'bruto' }).then(lista => {
      if (!activo) return;
      const vigentes = lista.filter(t => t.id !== ticket.id && t.estado === 'bruto' && !t.pesajeExterior && !t.ticketPrincipalId);
      setCandidatos(vigentes);
      // Un ticket unido de un borrador que ya se completó/unió en otro lado no puede seguir marcado.
      const { validos, descartados } = intersectarIds(unidosRef.current, vigentes.map(t => t.id));
      if (descartados.length > 0) {
        setUnidosIds(validos);
        setAvisoSaneo(mensajeSaneoBorrador([descartados.length === 1 ? 'un ticket unido' : `${descartados.length} tickets unidos`]));
      }
    });
    return () => { activo = false; };
  }, [puedeUnir, ticket.entidadId, ticket.id]);

  const alternarUnido = (id: string) =>
    setUnidosIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

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
    setFotosDevolucion(prev => [...prev, ...files.map(file => ({ tipo: 'nueva' as const, file, preview: URL.createObjectURL(file) }))]);
  const quitarFotoDevolucion = (idx: number) =>
    setFotosDevolucion(prev => prev.filter((_, i) => i !== idx));

  const pesoNetoTotal = useMemo(
    () => redondearKg(materiales.reduce((acc, f) => acc + netoFila(f, taras), 0)),
    [materiales, taras]
  );

  const unidos = useMemo(() => candidatos.filter(t => unidosIds.includes(t.id)), [candidatos, unidosIds]);
  const pesoGlobalSumado = useMemo(() => pesoGlobalTotal(ticket.pesoGlobal, unidos), [ticket.pesoGlobal, unidos]);

  // Bugfix: el peso global se toma del ticket guardado en bruto (no de un input
  // nuevo) para que la diferencia se calcule en vivo mientras se cargan los materiales.
  const diferencia = useMemo(
    () => calcularDiferenciaPeso({ pesoGlobal: pesoGlobalSumado, netoMateriales: pesoNetoTotal, devolucion: Number(devolucion) || 0 }),
    [pesoGlobalSumado, pesoNetoTotal, devolucion]
  );

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (materiales.some(f => !f.productoId)) { setError('Cada material debe tener un producto seleccionado.'); return; }
    if (materiales.some(f => !esFilaSinLote(f, productos) && !f.destino)) { setError('Cada material debe tener un destino seleccionado.'); return; }
    if (materiales.some(filaTaraIncompleta)) {
      setError('Selecciona la tara preconfigurada para las unidades ingresadas.');
      return;
    }
    if (materiales.some(f => taraFilaNoVigente(f, taras))) { setError(MENSAJE_TARA_NO_VIGENTE); return; }
    if (materiales.some(f => netoFila(f, taras) <= 0)) { setError('Cada material debe tener un peso neto mayor a 0.'); return; }
    if (materiales.some(f => f.fotos.length === 0)) { setError('Cada material necesita al menos una foto.'); return; }
    if (Number(devolucion) > 0 && fotosDevolucion.length === 0) { setError('Agrega al menos una foto de la devolución.'); return; }
    if (diferenciaFavoreceProveedor(diferencia, ticket.pesajeExterior)) {
      setError('La suma de materiales + devolución supera el peso global — eso favorece al proveedor. Revisa los pesos antes de guardar.');
      return;
    }

    setGuardando(true);
    const envio = iniciarEnvio(idEnvioRef.current);
    idEnvioRef.current = envio.id;
    const falloFotos = async (mensaje: string) => {
      await envio.guardador?.descartar();
      setError(mensaje);
      setGuardando(false);
    };

    const materialesConFotos: Array<ReturnType<typeof materialAPayload> & { fotos: string[] }> = [];
    for (const f of materiales) {
      const urls = await envio.subirFotos(f.fotos);
      if (!urls) {
        await falloFotos('No se pudieron guardar las fotos. Revisa la conexión y el espacio del teléfono; tu formulario sigue intacto.');
        return;
      }
      materialesConFotos.push({ ...materialAPayload(f, taras, productos), fotos: urls });
    }

    const urlsDevolucion = await envio.subirFotos(fotosDevolucion);
    if (!urlsDevolucion) {
      await falloFotos('No se pudieron guardar las fotos de la devolución. Revisa la conexión y el espacio del teléfono.');
      return;
    }

    const cuerpo = cuerpoCompletarTicket(materialesConFotos, Number(devolucion) || 0, urlsDevolucion, unidos.map(t => t.id), notas);
    const r = await enviarOEncolar({
      envio,
      tipo: 'ticket_completar',
      endpoint: `/api/tickets-pesaje/${ticket.id}/completar`,
      metodo: 'PATCH',
      payload: cuerpo,
      descripcion: `Completar ${ticket.codigo}`,
      enviarEnLinea: c => completarTicket(
        ticket.id, materialesConFotos, Number(devolucion) || 0, urlsDevolucion, unidos.map(t => t.id), notas,
        { clientRequestId: c.clientRequestId, capturadoEn: c.capturadoEn },
      ),
    });
    setGuardando(false);

    if (r.tipo === 'error') { setError(r.mensaje); return; }
    idEnvioRef.current = null;
    toast.exito(r.tipo === 'encolado' ? mensajeGuardadoEnTelefono(`Completar ${ticket.codigo}`) : `${r.resultado.ticket.codigo} completado.`);
    onCompletado();
    cerrar();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-4xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-bold text-text-primary">Completar {ticket.codigo}</h2>
          <button type="button" onClick={cerrar} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <AvisoBorrador formulario="este ticket" aviso={borrador.aviso} onDescartar={borrador.descartar} onCerrar={borrador.cerrarAviso} />
          {avisoSaneo && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">{avisoSaneo}</p>}
          <p className="text-xs text-text-muted">
            Este pesaje global está por recepcionar. Registra los materiales y destinos definitivos para que se contabilice en el inventario.
          </p>

          {candidatos.length > 0 && (
            <div className="border border-border rounded-lg p-3 space-y-2 bg-surface-alt/40">
              <p className="text-xs font-semibold text-text-secondary">Otros tickets de este proveedor</p>
              <p className="text-[11px] text-text-muted">Selecciona los que quieras sumar a este pesaje. Sus pesos globales se suman y se completan juntos.</p>
              {candidatos.map(t => (
                <label key={t.id} className="flex items-center justify-between gap-3 text-sm cursor-pointer">
                  <span className="flex items-center gap-2 text-text-primary">
                    <input type="checkbox" checked={unidosIds.includes(t.id)} onChange={() => alternarUnido(t.id)} />
                    {t.codigo}
                    <span className="text-xs text-text-muted">{t.fecha ?? '—'}</span>
                  </span>
                  <span className="font-medium text-text-secondary">{fmt(t.pesoGlobal)} kg</span>
                </label>
              ))}
            </div>
          )}

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
                    {esFilaSinLote(f, productos) ? (
                      <>
                        <label className={labelClass}>&nbsp;</label>
                        <p className="text-xs text-text-muted bg-surface-alt border border-border rounded-lg px-3 py-2">
                          Categoría sin lote — va directo a inventario general.
                        </p>
                      </>
                    ) : (
                      <>
                        <label className={labelClass}>Destino (inventario) *</label>
                        <SelectorDestinoLote lotes={lotes} loteIdsPosibles={loteIdsPosiblesFila(f, productos)} valor={f.destino} onChange={id => setFila(f.uid, 'destino', id)} />
                      </>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
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
                              {taras.find(t => t.id === f.taraId)?.nombre ?? '— Sin tara —'}
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
                  <div>
                    <label className={labelClass}>Peso bruto (kg)</label>
                    <input type="number" step="0.001" min="0" value={f.pesoBruto} onChange={e => setFila(f.uid, 'pesoBruto', e.target.value)} className={inputClass} placeholder="0.00" />
                  </div>
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
              </div>
            );
          })}

          <button type="button" onClick={agregarMaterial} className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors">
            <Plus size={16} />
            Agregar material
          </button>

          <div className="bg-brand-50 border border-brand-200 rounded-lg px-4 py-3 space-y-2">
            {ticket.pesajeExterior ? (
              <p className="text-xs text-brand-800">Sin pesaje global — no hay peso global para reconciliar.</p>
            ) : (
              <div className="flex items-center justify-between text-sm">
                <span className="text-brand-800">{unidos.length > 0 ? `Peso global total (${unidos.length + 1} tickets)` : 'Peso global (de este pesaje)'}</span>
                <span className="font-semibold text-brand-700">{fmt(pesoGlobalSumado)} kg</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium text-brand-800">
                <Scale size={16} />
                Suma de materiales
              </span>
              <span className={`text-lg font-bold ${pesoNetoTotal < 0 ? 'text-red-600' : 'text-brand-700'}`}>
                {fmt(pesoNetoTotal)} kg
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm border-t border-brand-200 pt-2">
              <label htmlFor="devolucion-completar" className="text-brand-800 shrink-0">Devolución (kg)</label>
              <input
                id="devolucion-completar"
                type="number"
                step="0.001"
                min="0"
                value={devolucion}
                onChange={e => setDevolucion(e.target.value)}
                className="w-28 px-2 py-1 bg-surface border border-brand-200 rounded-md text-sm text-right focus:outline-none focus:ring-2 focus:ring-brand-400"
                placeholder="0.00"
              />
            </div>
            <FotoMaterialPicker
              label="Fotos de la devolución"
              fotos={fotosDevolucion}
              onAgregar={agregarFotosDevolucion}
              onQuitar={quitarFotoDevolucion}
            />
            {!ticket.pesajeExterior && (
              <div className="flex items-center justify-between text-sm border-t border-brand-200 pt-2">
                <span className="text-brand-800">Diferencia (global vs. neto + devolución)</span>
                <span className={`font-semibold ${colorClaseDiferencia(diferencia, pesoGlobalSumado, ticket.pesajeExterior)}`}>
                  {fmt(diferencia)} kg
                  <span className="ml-1 font-normal text-xs text-brand-700">({descripcionDiferencia(diferencia)})</span>
                </span>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="notas-completar" className={labelClass}>Notas del pesaje (opcional)</label>
            <textarea
              id="notas-completar"
              value={notas}
              onChange={e => setNotas(e.target.value)}
              maxLength={MAX_NOTAS}
              rows={3}
              className={inputClass}
              placeholder="Cualquier detalle que quieras dejar en el ticket"
            />
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={cerrar} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? <><Loader2 size={16} className="animate-spin" /> Guardando...</> : 'Completar ticket'}
            </button>
          </div>
        </form>
      </div>

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

export default CompletarTicketModal;
