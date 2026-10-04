import { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Plus, Loader2, Trash2, ChevronDown, AlertTriangle, TrendingDown } from 'lucide-react';
import {
  obtenerTransformaciones,
  borrarTransformacion,
  crearTransformacionFerroso,
  completarTransformacionFerroso,
  obtenerSalidasComunes,
  crearTransformacionPCB,
  completarTransformacionPCB,
  completarTransformacionMixta,
  type CrearTransformacionFerrosoInput,
  type CompletarTransformacionFerrosoSalidaInput,
} from '../../services/transformacion-service';
import { obtenerProductos } from '../../services/producto-service';
import { obtenerAlmacenes, obtenerStockAlmacen } from '../../services/almacen-service';
import { obtenerTaras } from '../../services/tara-service';
import { obtenerLotes } from '../../services/lote-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { useConfirm } from '../../hooks/use-confirm-context';
import { usePestanaRecordada } from '../../hooks/use-pestana-recordada';
import { subirFotoTicket } from '../../services/storage-service';
import { subirFotosLocal } from '../../lib/foto-picker';
import SeleccionarMaterialModal from '../pesaje/SeleccionarMaterialModal';
import SeleccionarTaraModal from '../pesaje/SeleccionarTaraModal';
import SeleccionarEntidadModal from '../../components/SeleccionarEntidadModal';
import FotoMaterialPicker from '../pesaje/FotoMaterialPicker';
import { taraKgFila, taraFilaNoVigente, MENSAJE_TARA_NO_VIGENTE, seleccionarTaraFila, taraVacia, type CampoTara, type FotoMaterial } from '../pesaje/material-fila';
import type { Transformacion, SalidaComun, Tara, Lote } from '@shared/types/index.js';
import { SelectorTipoSalida, BloqueLoteDestino, BloqueMaterialDestino } from './SalidaMixtaFila';
import { hayFilasMixtas, validarSalidas, armarSalidaMixta, type TipoSalida } from '../../lib/salida-mixta';
import AvisoBorrador from '../../components/AvisoBorrador';
import MermaPorTipoBloque from './MermaPorTipoBloque';
import { armarMermaDetalle, mermaFormVacio, validarMermaForm, type MermaForm } from '../../lib/merma-tipificada';
import { useBorradorPersistente } from '../../hooks/use-borrador-persistente';
import { difiereEstado, restaurarFilas } from '../../lib/borrador';
import { fechaRestaurable, idVigenteOVacio, mensajeSaneoBorrador, sanearIdsSalida, sanearTara } from '../../lib/borrador-vigentes';
import { BotonAccion, ControlSegmentado, EncabezadoPagina, Pestanas, useFiltrosUrl } from '../../components/ui';
import PestanaPendientes from './PestanaPendientes';
import PestanaHistorial from './PestanaHistorial';
import PestanaConfig from './PestanaConfig';
import {
  ESQUEMA_FILTROS_TRANSFORMACIONES, PESTANAS_TRANSFORMACIONES, useUmbralMerma, type PestanaTransformaciones,
} from './transformaciones-comun';
import type { Producto } from '@shared/types/index.js';
import type { Almacen } from '@shared/types/index.js';

type Categoria = 'ferroso_no_ferroso' | 'pcb';

function hoyISO() { return new Date().toISOString().slice(0, 10); }
function fmt(n: number) { return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 3 }); }

// ---------------------------------------------------------------------------
// Fila de salida en el formulario de completar
// ---------------------------------------------------------------------------
interface FilaSalida extends CampoTara {
  uid: number;
  productoId: string;
  /** 'lote' = salida mixta: el material de la fila va a un lote existente. */
  tipo: TipoSalida;
  loteDestinoId: string;
  almacenId: string;
  pesoBruto: string;
  fotos: FotoMaterial[];
}

let nextUid = 1;
function filaVacia(productoId = ''): FilaSalida {
  return { uid: nextUid++, productoId, tipo: 'material', loteDestinoId: '', almacenId: '', pesoBruto: '', ...taraVacia(), fotos: [] };
}

const OPCIONES_TIPO_FERROSO = [
  { tipo: 'material' as const, etiqueta: 'Material' },
  { tipo: 'lote' as const, etiqueta: 'Lote' },
];
const OPCIONES_TIPO_PCB = [
  { tipo: 'lote' as const, etiqueta: 'Lote' },
  { tipo: 'material' as const, etiqueta: 'Material' },
];

// ---------------------------------------------------------------------------
// Modal: Completar transformación ferroso
// ---------------------------------------------------------------------------
function CompletarFerrosoModal({
  transformacion,
  productos,
  taras,
  salidasComunes,
  lotes,
  almacenes,
  onClose,
  onCompletada,
}: {
  transformacion: Transformacion;
  productos: Producto[];
  taras: Tara[];
  salidasComunes: SalidaComun[];
  lotes: Lote[];
  almacenes: Almacen[];
  onClose: () => void;
  onCompletada: () => void;
}) {
  const toast = useToast();
  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  const comunesIds = salidasComunes.map(s => s.productoSalidaId);

  const filasIniciales = (): FilaSalida[] => (comunesIds.length > 0 ? comunesIds.map(id => filaVacia(id)) : [filaVacia()]);
  const [filas, setFilas] = useState<FilaSalida[]>(filasIniciales);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filaActivaUid, setFilaActivaUid] = useState<number | null>(null);
  const [mostrarSelectorMaterial, setMostrarSelectorMaterial] = useState(false);
  const [mostrarSelectorTara, setMostrarSelectorTara] = useState(false);
  const [mostrarSelectorLote, setMostrarSelectorLote] = useState(false);
  const [avisoSaneo, setAvisoSaneo] = useState<string | null>(null);

  const borrador = useBorradorPersistente<{ filas: FilaSalida[] }>({
    formulario: 'transformacion-completar',
    docId: transformacion.id,
    version: 1,
    estado: { filas },
    hayCambios: difiereEstado({ filas }, { filas: filasIniciales() }),
    aplicar: d => {
      // Material, lote, almacén o tara que ya no existen quedan sin elegir, con aviso.
      const ids = sanearIdsSalida(restaurarFilas(d.filas, () => filaVacia()), {
        productoIds: productos.map(p => p.id),
        loteIds: lotes.filter(l => l.activo).map(l => l.id),
        almacenIds: almacenes.map(a => a.id),
      });
      let tarasReseteadas = 0;
      const filasOk = ids.filas.map(f => {
        const t = sanearTara(f, taras.map(x => x.id));
        if (t.cambiada) tarasReseteadas += 1;
        return t.fila;
      });
      const elementos: string[] = [];
      if (ids.descartados > 0) elementos.push('material, lote o almacén de alguna salida');
      if (tarasReseteadas > 0) elementos.push(tarasReseteadas === 1 ? 'una tara' : `${tarasReseteadas} taras`);
      setAvisoSaneo(mensajeSaneoBorrador(elementos));
      setFilas(filasOk);
    },
    restablecer: () => { setFilas(filasIniciales()); setAvisoSaneo(null); },
  });
  // Cerrar (X o Cancelar) descarta el borrador guardado.
  const cerrar = () => { borrador.limpiar(); onClose(); };

  const actualizar = (uid: number, campo: Partial<FilaSalida>) => {
    setFilas(prev => prev.map(f => f.uid === uid ? { ...f, ...campo } : f));
  };

  // Comunes primero para que sigan apareciendo destacados en la grilla visual.
  const productosOrdenados = [
    ...productos.filter(p => comunesIds.includes(p.id)),
    ...productos.filter(p => !comunesIds.includes(p.id)),
  ];

  const netoFila = (f: FilaSalida) => (Number(f.pesoBruto) || 0) - taraKgFila(f, taras);
  const totalSalidas = filas.reduce((acc, f) => acc + netoFila(f), 0);
  const merma = transformacion.pesoNeto - totalSalidas;
  // Merma por tipo: opcional, no forma parte del borrador persistente.
  const [mermaForm, setMermaForm] = useState<MermaForm>(mermaFormVacio);

  const handleCompletar = async () => {
    setError(null);
    // Salida a lote: el material que entra al lote es el de entrada de la transformación.
    const filasEfectivas = filas.map(f => (f.tipo === 'lote' ? { ...f, productoId: transformacion.productoEntradaId ?? '' } : f));
    if (filasEfectivas.some(f => taraFilaNoVigente(f, taras))) { setError(MENSAJE_TARA_NO_VIGENTE); return; }
    const errorValidacion = validarSalidas(
      'ferroso_no_ferroso',
      filasEfectivas.map(f => ({ ...f, neto: netoFila(f), cantidadFotos: f.fotos.length })),
      { pesoEntrada: transformacion.pesoNeto }
    );
    if (errorValidacion) { setError(errorValidacion); return; }
    const errorMerma = validarMermaForm(merma, mermaForm);
    if (errorMerma) { setError(errorMerma); return; }

    setGuardando(true);
    const fotasPorFila = await Promise.all(filasEfectivas.map(f => subirFotosLocal(f.fotos, subirFotoTicket)));
    if (fotasPorFila.some(urls => urls === null)) {
      setError('No se pudo subir una de las fotos. Intenta de nuevo.');
      setGuardando(false);
      return;
    }
    const result = hayFilasMixtas('ferroso_no_ferroso', filasEfectivas)
      ? await completarTransformacionMixta(
        transformacion.id,
        filasEfectivas.map((f, i) => armarSalidaMixta('ferroso_no_ferroso', f, Number(f.pesoBruto), taraKgFila(f, taras), fotasPorFila[i] as string[])),
        armarMermaDetalle(mermaForm)
      )
      : await completarTransformacionFerroso(transformacion.id, filasEfectivas.map((f, i): CompletarTransformacionFerrosoSalidaInput => ({
        productoId: f.productoId,
        pesoBruto: Number(f.pesoBruto),
        tara: taraKgFila(f, taras),
        fotos: fotasPorFila[i] as string[],
      })), armarMermaDetalle(mermaForm));
    setGuardando(false);
    if ('error' in result) { setError(result.error); return; }
    toast.exito('Transformación completada.');
    if (result.advertencia) toast.advertencia(result.advertencia);
    borrador.limpiar();
    onCompletada();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-surface rounded-xl border border-border w-full max-w-xl my-8 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-text-primary">Completar transformación</h2>
            <p className="text-xs text-text-muted mt-0.5">
              Entrada: <span className="font-medium">{transformacion.nombreProductoEntrada}</span> — {fmt(transformacion.pesoNeto)} kg
            </p>
          </div>
          <button onClick={cerrar} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
        </div>

        <AvisoBorrador className="mb-3" formulario="esta transformación" aviso={borrador.aviso} onDescartar={borrador.descartar} onCerrar={borrador.cerrarAviso} />
        {avisoSaneo && <p role="status" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">{avisoSaneo}</p>}
        <div className="space-y-3 mb-4">
          {filas.map((f, idx) => (
            <div key={f.uid} className="bg-surface-alt rounded-lg p-3 border border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-text-secondary">Salida {idx + 1}</span>
                {filas.length > 1 && (
                  <button type="button" onClick={() => setFilas(prev => prev.filter(x => x.uid !== f.uid))} className="text-text-muted hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <div className="space-y-2">
                <SelectorTipoSalida valor={f.tipo} opciones={OPCIONES_TIPO_FERROSO} onCambiar={tipo => actualizar(f.uid, { tipo })} />
                {f.tipo === 'material' && (
                  <div>
                    <label className={labelClass}>Material *</label>
                    <button
                      type="button"
                      onClick={() => { setFilaActivaUid(f.uid); setMostrarSelectorMaterial(true); }}
                      className={`${inputClass} flex items-center justify-between gap-2 text-left`}
                    >
                      <span className={f.productoId ? 'text-text-primary truncate' : 'text-text-muted'}>
                        {productos.find(p => p.id === f.productoId)?.nombre ?? '-Selecciona-'}
                      </span>
                      <ChevronDown size={14} className="text-text-muted shrink-0" />
                    </button>
                  </div>
                )}
                {f.tipo === 'lote' && (
                  <BloqueLoteDestino
                    lote={lotes.find(l => l.id === f.loteDestinoId)}
                    almacenId={f.almacenId}
                    almacenes={almacenes}
                    entradaDetalle={[{ productoId: transformacion.productoEntradaId ?? '', nombreProducto: transformacion.nombreProductoEntrada ?? '', pesoKg: 1 }]}
                    neto={netoFila(f)}
                    onElegirLote={() => { setFilaActivaUid(f.uid); setMostrarSelectorLote(true); }}
                    onCambiarAlmacen={almacenId => actualizar(f.uid, { almacenId })}
                  />
                )}
                <div>
                  <label className={labelClass}>Peso bruto (kg) *</label>
                  <input type="number" step="0.001" min="0.001" value={f.pesoBruto}
                    onChange={e => actualizar(f.uid, { pesoBruto: e.target.value })}
                    className={inputClass} placeholder="0.00" />
                </div>
                <div>
                  <label className={labelClass}>Tara</label>
                  <div className="flex rounded-md overflow-hidden border border-border text-[11px] w-fit mb-1.5">
                    <button type="button" onClick={() => actualizar(f.uid, { taraModo: 'preconfigurada' })} className={`px-2 py-1 ${f.taraModo === 'preconfigurada' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
                      Preconfigurada
                    </button>
                    <button type="button" onClick={() => actualizar(f.uid, { taraModo: 'manual' })} className={`px-2 py-1 ${f.taraModo === 'manual' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
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
                        <input type="number" step="1" min="0" value={f.taraCantidad} onChange={e => actualizar(f.uid, { taraCantidad: e.target.value })} className={inputClass} placeholder="Cantidad" />
                      </div>
                      <p className="text-[11px] text-text-muted mt-1">= {fmt(taraKgFila(f, taras))} kg</p>
                    </div>
                  ) : (
                    <input type="number" step="0.001" min="0" value={f.taraManual} onChange={e => actualizar(f.uid, { taraManual: e.target.value })} className={inputClass} placeholder="0.00" />
                  )}
                </div>
                <p className="text-xs text-text-muted">
                  Neto: <span className="font-semibold text-text-primary">{fmt(netoFila(f))} kg</span>
                </p>
                <FotoMaterialPicker
                  label="Fotos de esta salida"
                  fotos={f.fotos}
                  onAgregar={files => actualizar(f.uid, {
                    fotos: [...f.fotos, ...files.map(file => ({ tipo: 'nueva' as const, file, preview: URL.createObjectURL(file) }))],
                  })}
                  onQuitar={idx => actualizar(f.uid, { fotos: f.fotos.filter((_, i) => i !== idx) })}
                />
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setFilas(prev => [...prev, filaVacia()])}
          className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-border rounded-lg text-sm text-text-muted hover:text-text-secondary hover:border-brand-400 transition-colors mb-4"
        >
          <Plus size={14} /> Agregar material de salida
        </button>

        <div className="bg-surface-alt rounded-lg p-3 mb-4 text-xs space-y-1 border border-border">
          <div className="flex justify-between text-text-secondary"><span>Entrada total</span><span className="font-medium">{fmt(transformacion.pesoNeto)} kg</span></div>
          <div className="flex justify-between text-text-secondary"><span>Salidas totales</span><span className="font-medium">{fmt(totalSalidas)} kg</span></div>
          <div className={`flex justify-between font-medium ${merma < 0 ? 'text-red-600' : 'text-text-muted'}`}>
            <span>Merma</span><span>{fmt(merma)} kg</span>
          </div>
        </div>

        <div className="mb-4">
          <MermaPorTipoBloque mermaKg={merma} valores={mermaForm} onCambiar={setMermaForm} />
        </div>

        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

        <div className="flex gap-3">
          <button onClick={cerrar} className="flex-1 py-2.5 border border-border rounded-lg text-sm text-text-secondary hover:bg-surface-alt transition-colors">
            Cancelar
          </button>
          <button onClick={handleCompletar} disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {guardando ? <><Loader2 size={15} className="animate-spin" /> Guardando...</> : 'Completar transformación'}
          </button>
        </div>
      </div>

      {mostrarSelectorMaterial && (
        <SeleccionarMaterialModal
          productos={productosOrdenados}
          onClose={() => setMostrarSelectorMaterial(false)}
          onSeleccionar={id => {
            if (filaActivaUid != null) actualizar(filaActivaUid, { productoId: id });
            setMostrarSelectorMaterial(false);
          }}
        />
      )}
      {mostrarSelectorLote && (
        <SeleccionarEntidadModal
          titulo="Selecciona el lote de destino"
          entidades={lotes.filter(l => l.activo).map(l => ({ id: l.id, nombre: `${l.nombre} — ${fmt(l.stockKg)} kg`, fotos: l.fotos }))}
          onClose={() => setMostrarSelectorLote(false)}
          onSeleccionar={id => { if (filaActivaUid != null) actualizar(filaActivaUid, { loteDestinoId: id }); setMostrarSelectorLote(false); }}
        />
      )}
      {mostrarSelectorTara && (
        <SeleccionarTaraModal
          taras={taras}
          taraSeleccionada={filas.find(f => f.uid === filaActivaUid)?.taraId || undefined}
          onClose={() => setMostrarSelectorTara(false)}
          onSeleccionar={taraId => {
            if (filaActivaUid != null) {
              const fila = filas.find(f => f.uid === filaActivaUid);
              if (fila) actualizar(filaActivaUid, seleccionarTaraFila(fila, taraId));
            }
            setMostrarSelectorTara(false);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulario: Nueva transformación ferroso
// ---------------------------------------------------------------------------
function NuevaFerrosoForm({
  productos,
  almacenes,
  taras,
  catalogosListos,
  onCreada,
}: {
  productos: Producto[];
  almacenes: Almacen[];
  taras: Tara[];
  /** Los catálogos ya cargaron: recién entonces se puede validar un borrador restaurado. */
  catalogosListos: boolean;
  onCreada: () => void;
}) {
  const toast = useToast();
  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  const [productoEntradaId, setProductoEntradaId] = useState('');
  const [almacenId, setAlmacenId] = useState('');
  const [pesoBruto, setPesoBruto] = useState('');
  const [campoTara, setCampoTara] = useState<CampoTara>(taraVacia());
  const [fotos, setFotos] = useState<FotoMaterial[]>([]);
  const [fecha, setFecha] = useState(hoyISO());
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mostrarSelectorMaterial, setMostrarSelectorMaterial] = useState(false);
  const [mostrarSelectorTara, setMostrarSelectorTara] = useState(false);
  const [stockAlmacen, setStockAlmacen] = useState<Map<string, number>>(new Map());
  const [avisoSaneo, setAvisoSaneo] = useState<string | null>(null);

  const estadoBorrador = { productoEntradaId, almacenId, pesoBruto, campoTara, fotos, fecha, notas };
  const restablecer = () => {
    setProductoEntradaId('');
    setAlmacenId('');
    setPesoBruto('');
    setCampoTara(taraVacia());
    setFotos([]);
    setFecha(hoyISO());
    setNotas('');
    setAvisoSaneo(null);
  };
  const borrador = useBorradorPersistente<typeof estadoBorrador>({
    formulario: 'transformacion-nueva-ferroso',
    version: 1,
    habilitado: catalogosListos,
    estado: estadoBorrador,
    hayCambios: difiereEstado(estadoBorrador, { productoEntradaId: '', almacenId: '', pesoBruto: '', campoTara: taraVacia(), fotos: [], fecha: hoyISO(), notas: '' }),
    aplicar: d => {
      // Material, almacén o tara que ya no existen quedan sin elegir, con aviso.
      const productoOk = idVigenteOVacio(d.productoEntradaId ?? '', productos.map(p => p.id));
      const almacenOk = idVigenteOVacio(d.almacenId ?? '', almacenes.map(a => a.id));
      const tara = sanearTara({ ...taraVacia(), ...d.campoTara }, taras.map(t => t.id));
      const reseteos: string[] = [];
      if (productoOk !== (d.productoEntradaId ?? '')) reseteos.push('el material de entrada');
      if (almacenOk !== (d.almacenId ?? '')) reseteos.push('el almacén');
      if (tara.cambiada) reseteos.push('la tara');
      setAvisoSaneo(mensajeSaneoBorrador(reseteos));
      setProductoEntradaId(productoOk);
      setAlmacenId(almacenOk);
      setPesoBruto(d.pesoBruto ?? '');
      setCampoTara(tara.fila);
      setFotos(d.fotos ?? []);
      // Una fecha vieja no se restaura en silencio: una transformación nueva lleva la fecha de hoy.
      setFecha(fechaRestaurable(d.fecha, hoyISO()));
      setNotas(d.notas ?? '');
    },
    restablecer,
  });

  const neto = (Number(pesoBruto) || 0) - taraKgFila(campoTara, taras);

  // Aviso (sin bloquear, mismo criterio que traslados en Pesaje) si retirar
  // este neto deja el material en negativo en el almacén elegido.
  useEffect(() => {
    if (!almacenId) { setStockAlmacen(new Map()); return; }
    obtenerStockAlmacen(almacenId).then(setStockAlmacen);
  }, [almacenId]);
  const disponible = stockAlmacen.get(productoEntradaId) ?? 0;
  const quedaEnNegativo = productoEntradaId && almacenId && neto > 0 && neto > disponible;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!productoEntradaId) { setError('Selecciona el material de entrada.'); return; }
    if (!almacenId) { setError('Selecciona el almacén.'); return; }
    if (taraFilaNoVigente(campoTara, taras)) { setError(MENSAJE_TARA_NO_VIGENTE); return; }
    if (neto <= 0) { setError('El peso neto debe ser mayor a 0.'); return; }
    if (fotos.length === 0) { setError('Agrega al menos una foto de entrada.'); return; }

    setGuardando(true);
    const fotosUrls = await subirFotosLocal(fotos, subirFotoTicket);
    if (!fotosUrls) {
      setError('No se pudo subir una de las fotos. Intenta de nuevo.');
      setGuardando(false);
      return;
    }

    const input: CrearTransformacionFerrosoInput = {
      productoEntradaId,
      almacenId,
      pesoBruto: Number(pesoBruto),
      tara: taraKgFila(campoTara, taras),
      fecha,
      notas: notas.trim() || null,
      fotosEntrada: fotosUrls,
    };
    const result = await crearTransformacionFerroso(input);
    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    toast.exito('Transformación iniciada. Complétala cuando tengas las salidas pesadas.');
    borrador.limpiar();
    restablecer();
    onCreada();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
      <AvisoBorrador className="mb-3" formulario="nueva transformación" aviso={borrador.aviso} onDescartar={borrador.descartar} onCerrar={borrador.cerrarAviso} />
      {avisoSaneo && <p role="status" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">{avisoSaneo}</p>}
      <div>
        <label className={labelClass}>Material de entrada *</label>
        <button
          type="button"
          onClick={() => setMostrarSelectorMaterial(true)}
          className={`${inputClass} flex items-center justify-between gap-2 text-left`}
        >
          <span className={productoEntradaId ? 'text-text-primary truncate' : 'text-text-muted'}>
            {productos.find(p => p.id === productoEntradaId)?.nombre ?? '-Selecciona el material a transformar-'}
          </span>
          <ChevronDown size={14} className="text-text-muted shrink-0" />
        </button>
      </div>

      <div>
        <label className={labelClass}>Almacén de origen *</label>
        <select required value={almacenId} onChange={e => setAlmacenId(e.target.value)} className={inputClass}>
          <option value="" disabled>-Selecciona el almacén-</option>
          {almacenes.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
      </div>

      <div>
        <label className={labelClass}>Peso bruto (kg) *</label>
        <input type="number" step="0.001" min="0.001" required value={pesoBruto}
          onChange={e => setPesoBruto(e.target.value)} className={inputClass} placeholder="0.00" />
      </div>

      <div>
        <label className={labelClass}>Tara</label>
        <div className="flex rounded-md overflow-hidden border border-border text-[11px] w-fit mb-1.5">
          <button type="button" onClick={() => setCampoTara(prev => ({ ...prev, taraModo: 'preconfigurada' }))} className={`px-2 py-1 ${campoTara.taraModo === 'preconfigurada' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
            Preconfigurada
          </button>
          <button type="button" onClick={() => setCampoTara(prev => ({ ...prev, taraModo: 'manual' }))} className={`px-2 py-1 ${campoTara.taraModo === 'manual' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
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
                <ChevronDown size={14} className="text-text-muted shrink-0" />
              </button>
              <input type="number" step="1" min="0" value={campoTara.taraCantidad} onChange={e => setCampoTara(prev => ({ ...prev, taraCantidad: e.target.value }))} className={inputClass} placeholder="Cantidad" />
            </div>
            <p className="text-[11px] text-text-muted mt-1">= {fmt(taraKgFila(campoTara, taras))} kg</p>
          </div>
        ) : (
          <input type="number" step="0.001" min="0" value={campoTara.taraManual} onChange={e => setCampoTara(prev => ({ ...prev, taraManual: e.target.value }))} className={inputClass} placeholder="0.00" />
        )}
      </div>

      <p className="text-xs text-text-muted -mt-2">
        Neto a retirar: <span className="font-semibold text-text-primary">{fmt(neto)} kg</span>
      </p>

      {quedaEnNegativo && (
        <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 -mt-2">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>
            Ese almacén solo tiene {fmt(disponible)} kg disponibles de este material — el inventario quedará en {fmt(disponible - neto)} kg.
          </span>
        </div>
      )}

      <FotoMaterialPicker fotos={fotos} onAgregar={files => setFotos(prev => [...prev, ...files.map(file => ({ tipo: 'nueva' as const, file, preview: URL.createObjectURL(file) }))])} onQuitar={idx => setFotos(prev => prev.filter((_, i) => i !== idx))} label="Fotos de entrada *" />

      <div>
        <label className={labelClass}>Fecha</label>
        <input type="date" required value={fecha} onChange={e => setFecha(e.target.value)} className={inputClass} />
      </div>

      <div>
        <label className={labelClass}>Notas <span className="text-text-muted">(opcional)</span></label>
        <textarea value={notas} onChange={e => setNotas(e.target.value)}
          className={`${inputClass} resize-none`} rows={2} />
      </div>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      <button type="submit" disabled={guardando}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
        {guardando ? <><Loader2 size={15} className="animate-spin" /> Registrando...</> : 'Iniciar transformación'}
      </button>

      {mostrarSelectorMaterial && (
        <SeleccionarMaterialModal
          productos={productos}
          onClose={() => setMostrarSelectorMaterial(false)}
          onSeleccionar={id => { setProductoEntradaId(id); setMostrarSelectorMaterial(false); }}
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
    </form>
  );
}

// ---------------------------------------------------------------------------
// Formulario: Nueva transformación PCB
// ---------------------------------------------------------------------------
function NuevaPCBForm({ lotes, almacenes, catalogosListos, onCreada }: { lotes: Lote[]; almacenes: Almacen[]; catalogosListos: boolean; onCreada: () => void }) {
  const toast = useToast();
  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  const [loteOrigenId, setLoteOrigenId] = useState('');
  const [almacenId, setAlmacenId] = useState('');
  const [pesoBruto, setPesoBruto] = useState('');
  const [tara, setTara] = useState('');
  const [fecha, setFecha] = useState(hoyISO());
  const [notas, setNotas] = useState('');
  const [fotos, setFotos] = useState<FotoMaterial[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mostrarSelectorLote, setMostrarSelectorLote] = useState(false);
  const [avisoSaneo, setAvisoSaneo] = useState<string | null>(null);

  const estadoBorrador = { loteOrigenId, almacenId, pesoBruto, tara, fecha, notas, fotos };
  const restablecer = () => {
    setLoteOrigenId(''); setAlmacenId(''); setPesoBruto(''); setTara(''); setFotos([]); setFecha(hoyISO()); setNotas(''); setAvisoSaneo(null);
  };
  const borrador = useBorradorPersistente<typeof estadoBorrador>({
    formulario: 'transformacion-nueva-pcb',
    version: 1,
    habilitado: catalogosListos,
    estado: estadoBorrador,
    hayCambios: difiereEstado(estadoBorrador, { loteOrigenId: '', almacenId: '', pesoBruto: '', tara: '', fecha: hoyISO(), notas: '', fotos: [] }),
    aplicar: d => {
      // Lote o almacén que ya no existen (o se desactivó el lote) quedan sin elegir, con aviso.
      const loteOk = idVigenteOVacio(d.loteOrigenId ?? '', lotes.filter(l => l.activo).map(l => l.id));
      const almacenOk = idVigenteOVacio(d.almacenId ?? '', almacenes.map(a => a.id));
      const reseteos: string[] = [];
      if (loteOk !== (d.loteOrigenId ?? '')) reseteos.push('el lote de origen');
      if (almacenOk !== (d.almacenId ?? '')) reseteos.push('el almacén');
      setAvisoSaneo(mensajeSaneoBorrador(reseteos));
      setLoteOrigenId(loteOk);
      setAlmacenId(almacenOk);
      setPesoBruto(d.pesoBruto ?? '');
      setTara(d.tara ?? '');
      // Una fecha vieja no se restaura en silencio: una transformación nueva lleva la fecha de hoy.
      setFecha(fechaRestaurable(d.fecha, hoyISO()));
      setNotas(d.notas ?? '');
      setFotos(d.fotos ?? []);
    },
    restablecer,
  });

  const loteOrigen = lotes.find(l => l.id === loteOrigenId);
  const neto = (Number(pesoBruto) || 0) - (Number(tara) || 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!loteOrigenId) { setError('Selecciona el lote de origen.'); return; }
    if (!almacenId) { setError('Selecciona de qué almacén sale el lote.'); return; }
    if (neto <= 0) { setError('El peso neto debe ser mayor a 0.'); return; }
    if (fotos.length === 0) { setError('Agrega al menos una foto de entrada.'); return; }
    setGuardando(true);
    const fotosUrls = await subirFotosLocal(fotos, subirFotoTicket);
    if (!fotosUrls) {
      setError('No se pudo subir una de las fotos. Intenta de nuevo.');
      setGuardando(false);
      return;
    }
    const result = await crearTransformacionPCB({
      loteOrigenId,
      almacenId,
      pesoBruto: Number(pesoBruto),
      tara: Number(tara) || 0,
      fecha,
      notas: notas.trim() || null,
      fotosEntrada: fotosUrls,
    });
    setGuardando(false);
    if ('error' in result) { setError(result.error); return; }
    toast.exito('Transformación PCB iniciada. Complétala cuando tengas las salidas pesadas.');
    borrador.limpiar();
    restablecer();
    onCreada();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
      <AvisoBorrador className="mb-3" formulario="nueva transformación PCB" aviso={borrador.aviso} onDescartar={borrador.descartar} onCerrar={borrador.cerrarAviso} />
      {avisoSaneo && <p role="status" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">{avisoSaneo}</p>}
      <div>
        <label className={labelClass}>Lote de origen *</label>
        <button type="button" onClick={() => setMostrarSelectorLote(true)}
          className={`${inputClass} flex items-center justify-between gap-2 text-left`}>
          <span className={loteOrigenId ? 'text-text-primary truncate' : 'text-text-muted'}>
            {loteOrigen?.nombre ?? '-Selecciona el lote-'}
          </span>
          <ChevronDown size={14} className="text-text-muted shrink-0" />
        </button>
        {loteOrigen && (
          <p className="text-xs text-text-muted mt-1">Stock total (todos los almacenes): <span className="font-medium">{fmt(loteOrigen.stockKg)} kg</span></p>
        )}
        {loteOrigen && loteOrigen.stockPorAlmacen.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {loteOrigen.stockPorAlmacen.map(s => (
              <span key={s.almacenId} className="text-[11px] bg-surface-alt border border-border rounded-full px-2 py-0.5 text-text-secondary">
                {s.almacenNombre}: {fmt(s.stockKg)} kg
              </span>
            ))}
          </div>
        )}
      </div>
      <div>
        <label className={labelClass}>Almacén de origen *</label>
        <select required value={almacenId} onChange={e => setAlmacenId(e.target.value)} className={inputClass}>
          <option value="" disabled>-Selecciona de qué almacén sale el lote-</option>
          {almacenes.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
        {/* La composición de un lote es POR ALMACÉN: cada uno acumula sus
            propias compras/transformaciones por separado (ver
            docs/migration_lote_composicion_por_almacen.sql). Por eso esto
            solo se muestra una vez elegido el almacén, y es lo que el
            backend realmente usa para repartir la entrada. */}
        {loteOrigen && almacenId && (() => {
          const composicionEnAlmacen = loteOrigen.stockPorAlmacen.find(s => s.almacenId === almacenId)?.composicion ?? [];
          if (composicionEnAlmacen.length === 0) {
            return <p className="text-xs text-text-muted mt-1">Sin composición conocida en este almacén todavía.</p>;
          }
          return (
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="text-[10px] text-text-muted w-full mb-0.5">Composición de este lote en este almacén:</span>
              {composicionEnAlmacen.map(c => (
                <span key={c.item} className="text-[11px] bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
                  {c.item}: {c.porcentaje}%
                </span>
              ))}
            </div>
          );
        })()}
      </div>
      <div>
        <label className={labelClass}>Peso bruto a retirar (kg) *</label>
        <input type="number" step="0.001" min="0.001" required value={pesoBruto}
          onChange={e => setPesoBruto(e.target.value)} className={inputClass} placeholder="0.00" />
      </div>
      <div>
        <label className={labelClass}>Tara (kg)</label>
        <input type="number" step="0.001" min="0" value={tara}
          onChange={e => setTara(e.target.value)} className={inputClass} placeholder="0.00" />
      </div>
      <p className="text-xs text-text-muted -mt-2">Neto a retirar: <span className="font-semibold text-text-primary">{fmt(neto)} kg</span></p>
      <FotoMaterialPicker fotos={fotos}
        onAgregar={files => setFotos(prev => [...prev, ...files.map(file => ({ tipo: 'nueva' as const, file, preview: URL.createObjectURL(file) }))])}
        onQuitar={idx => setFotos(prev => prev.filter((_, i) => i !== idx))} label="Fotos de entrada *" />
      <div>
        <label className={labelClass}>Fecha</label>
        <input type="date" required value={fecha} onChange={e => setFecha(e.target.value)} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Notas <span className="text-text-muted">(opcional)</span></label>
        <textarea value={notas} onChange={e => setNotas(e.target.value)} className={`${inputClass} resize-none`} rows={2} />
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button type="submit" disabled={guardando}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
        {guardando ? <><Loader2 size={15} className="animate-spin" /> Registrando...</> : 'Iniciar transformación PCB'}
      </button>
      {mostrarSelectorLote && (
        <SeleccionarEntidadModal
          titulo="Selecciona el lote de origen"
          entidades={lotes.filter(l => l.activo).map(l => ({ id: l.id, nombre: `${l.nombre} — ${fmt(l.stockKg)} kg`, fotos: l.fotos }))}
          onClose={() => setMostrarSelectorLote(false)}
          onSeleccionar={id => { setLoteOrigenId(id); setMostrarSelectorLote(false); }}
        />
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Modal: Completar transformación PCB
// ---------------------------------------------------------------------------
interface FilaSalidaPCB {
  uid: number;
  /** 'material' = salida mixta: material suelto (producto + almacén). */
  tipo: TipoSalida;
  productoId: string;
  loteDestinoId: string;
  almacenId: string;
  pesoBruto: string;
  tara: string;
  fotos: FotoMaterial[];
}
function filaSalidaPCBVacia(): FilaSalidaPCB {
  return { uid: nextUid++, tipo: 'lote', productoId: '', loteDestinoId: '', almacenId: '', pesoBruto: '', tara: '', fotos: [] };
}

function CompletarPCBModal({
  transformacion,
  lotes,
  almacenes,
  productos,
  onClose,
  onCompletada,
}: {
  transformacion: Transformacion;
  lotes: Lote[];
  almacenes: Almacen[];
  productos: Producto[];
  onClose: () => void;
  onCompletada: () => void;
}) {
  const toast = useToast();
  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  const [filas, setFilas] = useState<FilaSalidaPCB[]>(() => [filaSalidaPCBVacia()]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filaActivaUid, setFilaActivaUid] = useState<number | null>(null);
  const [mostrarSelectorLote, setMostrarSelectorLote] = useState(false);
  const [mostrarSelectorMaterial, setMostrarSelectorMaterial] = useState(false);
  const [avisoSaneo, setAvisoSaneo] = useState<string | null>(null);

  const borrador = useBorradorPersistente<{ filas: FilaSalidaPCB[] }>({
    formulario: 'transformacion-completar-pcb',
    docId: transformacion.id,
    version: 1,
    estado: { filas },
    hayCambios: difiereEstado({ filas }, { filas: [filaSalidaPCBVacia()] }),
    aplicar: d => {
      // Material, lote o almacén que ya no existen quedan sin elegir, con aviso.
      const ids = sanearIdsSalida(restaurarFilas(d.filas, filaSalidaPCBVacia), {
        productoIds: productos.map(p => p.id),
        loteIds: lotes.filter(l => l.activo).map(l => l.id),
        almacenIds: almacenes.map(a => a.id),
      });
      setAvisoSaneo(mensajeSaneoBorrador(ids.descartados > 0 ? ['material, lote o almacén de alguna salida'] : []));
      setFilas(ids.filas);
    },
    restablecer: () => { setFilas([filaSalidaPCBVacia()]); setAvisoSaneo(null); },
  });
  // Cerrar (X o Cancelar) descarta el borrador guardado.
  const cerrar = () => { borrador.limpiar(); onClose(); };

  const actualizar = (uid: number, campo: Partial<FilaSalidaPCB>) => {
    setFilas(prev => prev.map(f => f.uid === uid ? { ...f, ...campo } : f));
  };

  const netoFila = (f: FilaSalidaPCB) => (Number(f.pesoBruto) || 0) - (Number(f.tara) || 0);
  const totalSalidas = filas.reduce((acc, f) => acc + netoFila(f), 0);
  const restante = transformacion.pesoNeto - totalSalidas;
  // Merma por tipo: opcional, no forma parte del borrador persistente.
  const [mermaForm, setMermaForm] = useState<MermaForm>(mermaFormVacio);

  const handleCompletar = async () => {
    setError(null);
    const errorValidacion = validarSalidas(
      'pcb',
      filas.map(f => ({ ...f, neto: netoFila(f), cantidadFotos: f.fotos.length })),
      { loteOrigenId: transformacion.loteOrigenId, pesoEntrada: transformacion.pesoNeto }
    );
    if (errorValidacion) { setError(errorValidacion); return; }
    const errorMerma = validarMermaForm(restante, mermaForm);
    if (errorMerma) { setError(errorMerma); return; }

    setGuardando(true);
    const fotasPorFila = await Promise.all(filas.map(f => subirFotosLocal(f.fotos, subirFotoTicket)));
    if (fotasPorFila.some(urls => urls === null)) {
      setError('No se pudo subir una de las fotos. Intenta de nuevo.');
      setGuardando(false);
      return;
    }
    const result = hayFilasMixtas('pcb', filas)
      ? await completarTransformacionMixta(
        transformacion.id,
        filas.map((f, i) => armarSalidaMixta('pcb', f, Number(f.pesoBruto), Number(f.tara) || 0, fotasPorFila[i] as string[])),
        armarMermaDetalle(mermaForm)
      )
      : await completarTransformacionPCB(transformacion.id, filas.map((f, i) => ({
        loteDestinoId: f.loteDestinoId,
        almacenId: f.almacenId,
        pesoBruto: Number(f.pesoBruto),
        tara: Number(f.tara) || 0,
        fotos: fotasPorFila[i] as string[],
      })), armarMermaDetalle(mermaForm));
    setGuardando(false);
    if ('error' in result) { setError(result.error); return; }
    toast.exito('Transformación PCB completada.');
    if (result.advertencia) toast.advertencia(result.advertencia);
    borrador.limpiar();
    onCompletada();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-surface rounded-xl border border-border w-full max-w-xl my-8 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-text-primary">Completar transformación PCB</h2>
            <p className="text-xs text-text-muted mt-0.5">
              Origen: <span className="font-medium">{transformacion.nombreLoteOrigen ?? '—'}</span> — {fmt(transformacion.pesoNeto)} kg
            </p>
          </div>
          <button onClick={cerrar} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
        </div>

        <AvisoBorrador className="mb-3" formulario="esta transformación" aviso={borrador.aviso} onDescartar={borrador.descartar} onCerrar={borrador.cerrarAviso} />
        {avisoSaneo && <p role="status" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">{avisoSaneo}</p>}
        <div className="space-y-3 mb-4">
          {filas.map((f, idx) => {
            const loteDestino = lotes.find(l => l.id === f.loteDestinoId);
            return (
              <div key={f.uid} className="bg-surface-alt rounded-lg p-3 border border-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-text-secondary">Salida {idx + 1}</span>
                  {filas.length > 1 && (
                    <button type="button" onClick={() => setFilas(prev => prev.filter(x => x.uid !== f.uid))} className="text-text-muted hover:text-red-500">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  <SelectorTipoSalida valor={f.tipo} opciones={OPCIONES_TIPO_PCB} onCambiar={tipo => actualizar(f.uid, { tipo })} />
                  {f.tipo === 'lote' ? (
                    <BloqueLoteDestino
                      lote={loteDestino}
                      almacenId={f.almacenId}
                      almacenes={almacenes}
                      entradaDetalle={transformacion.entradaDetalle}
                      neto={netoFila(f)}
                      onElegirLote={() => { setFilaActivaUid(f.uid); setMostrarSelectorLote(true); }}
                      onCambiarAlmacen={almacenId => actualizar(f.uid, { almacenId })}
                    />
                  ) : (
                    <BloqueMaterialDestino
                      nombreProducto={productos.find(p => p.id === f.productoId)?.nombre}
                      almacenId={f.almacenId}
                      almacenes={almacenes}
                      onElegirProducto={() => { setFilaActivaUid(f.uid); setMostrarSelectorMaterial(true); }}
                      onCambiarAlmacen={almacenId => actualizar(f.uid, { almacenId })}
                    />
                  )}
                  <div>
                    <label className={labelClass}>Peso bruto de salida (kg) *</label>
                    <input type="number" step="0.001" min="0.001" value={f.pesoBruto}
                      onChange={e => actualizar(f.uid, { pesoBruto: e.target.value })} className={inputClass} placeholder="0.00" />
                  </div>
                  <div>
                    <label className={labelClass}>Tara (kg)</label>
                    <input type="number" step="0.001" min="0" value={f.tara}
                      onChange={e => actualizar(f.uid, { tara: e.target.value })} className={inputClass} placeholder="0.00" />
                  </div>
                  <p className="text-xs text-text-muted">Neto: <span className="font-semibold text-text-primary">{fmt(netoFila(f))} kg</span></p>
                  <FotoMaterialPicker
                    label="Fotos de esta salida (opcional)"
                    fotos={f.fotos}
                    onAgregar={files => actualizar(f.uid, { fotos: [...f.fotos, ...files.map(file => ({ tipo: 'nueva' as const, file, preview: URL.createObjectURL(file) }))] })}
                    onQuitar={idx2 => actualizar(f.uid, { fotos: f.fotos.filter((_, i) => i !== idx2) })}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setFilas(prev => [...prev, filaSalidaPCBVacia()])}
          className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-border rounded-lg text-sm text-text-muted hover:text-text-secondary hover:border-brand-400 transition-colors mb-4"
        >
          <Plus size={14} /> Agregar salida
        </button>

        <div className="bg-surface-alt rounded-lg p-3 mb-4 text-xs space-y-1 border border-border">
          <div className="flex justify-between text-text-secondary"><span>Entrada total</span><span className="font-medium">{fmt(transformacion.pesoNeto)} kg</span></div>
          <div className="flex justify-between text-text-secondary"><span>Salidas totales</span><span className="font-medium">{fmt(totalSalidas)} kg</span></div>
          <div className={`flex justify-between font-medium ${restante < 0 ? 'text-red-600' : 'text-text-muted'}`}>
            <span>{restante < 0 ? 'Excedente' : 'Restante'}</span><span>{fmt(Math.abs(restante))} kg</span>
          </div>
        </div>

        <div className="mb-4">
          <MermaPorTipoBloque mermaKg={restante} valores={mermaForm} onCambiar={setMermaForm} />
        </div>

        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

        <div className="flex gap-3">
          <button onClick={cerrar} className="flex-1 py-2.5 border border-border rounded-lg text-sm text-text-secondary hover:bg-surface-alt transition-colors">
            Cancelar
          </button>
          <button onClick={handleCompletar} disabled={guardando}
            className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {guardando ? <><Loader2 size={15} className="animate-spin" /> Guardando...</> : 'Completar'}
          </button>
        </div>

        {mostrarSelectorLote && (
          <SeleccionarEntidadModal
            titulo="Selecciona el lote de destino"
            entidades={lotes.filter(l => l.activo && l.id !== transformacion.loteOrigenId).map(l => ({ id: l.id, nombre: `${l.nombre} — ${fmt(l.stockKg)} kg`, fotos: l.fotos }))}
            onClose={() => setMostrarSelectorLote(false)}
            onSeleccionar={id => { if (filaActivaUid != null) actualizar(filaActivaUid, { loteDestinoId: id }); setMostrarSelectorLote(false); }}
          />
        )}
        {mostrarSelectorMaterial && (
          <SeleccionarMaterialModal
            productos={productos}
            onClose={() => setMostrarSelectorMaterial(false)}
            onSeleccionar={id => { if (filaActivaUid != null) actualizar(filaActivaUid, { productoId: id }); setMostrarSelectorMaterial(false); }}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------
const OPCIONES_CATEGORIA_NUEVA = [
  { valor: 'ferroso_no_ferroso' as const, etiqueta: 'Ferroso / No ferroso' },
  { valor: 'pcb' as const, etiqueta: 'PCB' },
];

function TransformacionesPage() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const puedeCrear = tienePermiso('transformaciones', 'crear');
  const puedeEliminar = tienePermiso('transformaciones', 'eliminar');

  // La pestaña recordada (misma clave de siempre) es el valor por defecto; ?tab= en la URL, si viene, manda.
  const { filtros, cambiar, limpiar } = useFiltrosUrl(ESQUEMA_FILTROS_TRANSFORMACIONES);
  const [tabRecordada, setTabRecordada] = usePestanaRecordada<PestanaTransformaciones>(
    'pronoia:transformaciones:tab',
    PESTANAS_TRANSFORMACIONES,
    'nueva',
  );
  const tab: PestanaTransformaciones = typeof filtros.tab === 'string' ? (filtros.tab as PestanaTransformaciones) : tabRecordada;
  const irAPestana = (t: PestanaTransformaciones) => { setTabRecordada(t); cambiar({ tab: t }); };

  // Categoría del formulario de la pestaña "Nueva" (no es el filtro de las listas, que vive en la URL).
  const [categoria, setCategoria] = useState<Categoria>('ferroso_no_ferroso');

  const [transformaciones, setTransformaciones] = useState<Transformacion[] | null>(null);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [taras, setTaras] = useState<Tara[]>([]);
  const [salidasComunes, setSalidasComunes] = useState<SalidaComun[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [catalogosListos, setCatalogosListos] = useState(false);

  const [completando, setCompletando] = useState<Transformacion | null>(null);
  const umbral = useUmbralMerma();

  const cargar = useCallback(async () => {
    const [txs, prods, alms, tars, comunes, lots] = await Promise.all([
      obtenerTransformaciones(),
      obtenerProductos(),
      obtenerAlmacenes(),
      obtenerTaras(),
      obtenerSalidasComunes(),
      obtenerLotes(),
    ]);
    setTransformaciones(txs);
    setProductos(prods.filter(p => p.activo));
    setAlmacenes(alms);
    setTaras(tars.filter(t => t.activo));
    setSalidasComunes(comunes);
    setLotes(lots);
    setCatalogosListos(true);
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const cancelar = async (t: Transformacion) => {
    const nombre = t.nombreProductoEntrada ?? t.nombreLoteOrigen ?? '?';
    const ok = await confirm({
      titulo: 'Cancelar transformación',
      mensaje: `¿Cancelar la transformación de ${fmt(t.pesoNeto)} kg de ${nombre}? Esta acción no se puede deshacer.`,
      confirmarLabel: 'Cancelar transformación',
      variante: 'danger',
    });
    if (!ok) return;
    const result = await borrarTransformacion(t.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito('Transformación cancelada.');
    void cargar();
  };

  const totalPendientes = useMemo(() => (transformaciones ?? []).filter(t => t.estado === 'bruto').length, [transformaciones]);
  const pestanas = useMemo(() => [
    { valor: 'nueva' as const, etiqueta: 'Nueva' },
    { valor: 'pendientes' as const, etiqueta: 'Pendientes', sufijo: transformaciones ? totalPendientes : undefined },
    { valor: 'historial' as const, etiqueta: 'Historial' },
    { valor: 'config' as const, etiqueta: 'Configuración' },
  ], [transformaciones, totalPendientes]);

  return (
    <div className="max-w-7xl">
      <EncabezadoPagina
        titulo="Transformaciones"
        subtitulo="Procesa materiales: retíralos del inventario, transforma, y registra lo que salió y cuánto se perdió."
        acciones={
          <>
            <BotonAccion variante="secundario" to="/transformaciones/merma" icono={<TrendingDown size={16} />}>Reporte de merma</BotonAccion>
            {puedeCrear && tab !== 'nueva' && <BotonAccion icono={<Plus size={16} />} onClick={() => irAPestana('nueva')}>Nueva transformación</BotonAccion>}
          </>
        }
      />

      <Pestanas pestanas={pestanas} valor={tab} onCambiar={irAPestana} etiquetaAria="Secciones de transformaciones">
        {/* --- Tab: Nueva --- */}
        {tab === 'nueva' && (
          <div>
            <div className="mb-4">
              <ControlSegmentado opciones={OPCIONES_CATEGORIA_NUEVA} valor={categoria} onCambiar={setCategoria} etiquetaAria="Categoría de la transformación" />
            </div>
            <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
              {puedeCrear ? (
                <>
                  <h2 className="text-lg font-semibold text-text-primary">
                    Nueva transformación — {categoria === 'pcb' ? 'PCB' : 'Ferroso / No Ferroso'}
                  </h2>
                  <p className="mb-4 mt-0.5 text-xs text-text-secondary">
                    Registra el material que sale del inventario para procesarlo. Al terminar, la completas desde Pendientes con lo que salió.
                  </p>
                  {categoria === 'pcb' ? (
                    <NuevaPCBForm
                      lotes={lotes}
                      almacenes={almacenes}
                      catalogosListos={catalogosListos}
                      onCreada={() => { void cargar(); irAPestana('pendientes'); }}
                    />
                  ) : (
                    <NuevaFerrosoForm
                      productos={productos}
                      almacenes={almacenes}
                      taras={taras}
                      catalogosListos={catalogosListos}
                      onCreada={() => { void cargar(); irAPestana('pendientes'); }}
                    />
                  )}
                </>
              ) : (
                <p className="text-sm text-text-secondary">No tienes permiso para registrar transformaciones.</p>
              )}
            </div>
          </div>
        )}

        {/* --- Tab: Pendientes --- */}
        {tab === 'pendientes' && (
          <PestanaPendientes
            transformaciones={transformaciones}
            filtros={filtros}
            onCambiarFiltros={cambiar}
            onLimpiarFiltros={limpiar}
            puedeCrear={puedeCrear}
            puedeEliminar={puedeEliminar}
            onCompletar={setCompletando}
            onCancelar={t => void cancelar(t)}
          />
        )}

        {/* --- Tab: Historial --- */}
        {tab === 'historial' && (
          <PestanaHistorial
            transformaciones={transformaciones}
            filtros={filtros}
            onCambiarFiltros={cambiar}
            onLimpiarFiltros={limpiar}
            umbral={umbral}
            onIrAPendientes={() => irAPestana('pendientes')}
          />
        )}

        {/* --- Tab: Config --- */}
        {tab === 'config' && (
          <PestanaConfig productos={productos} salidasComunes={salidasComunes} onSaved={() => void cargar()} umbral={umbral} />
        )}
      </Pestanas>

      {/* Modal completar */}
      {completando && completando.categoria === 'pcb' && (
        <CompletarPCBModal
          transformacion={completando}
          lotes={lotes}
          almacenes={almacenes}
          productos={productos}
          onClose={() => setCompletando(null)}
          onCompletada={() => { setCompletando(null); void cargar(); irAPestana('historial'); }}
        />
      )}
      {completando && completando.categoria !== 'pcb' && (
        <CompletarFerrosoModal
          transformacion={completando}
          productos={productos}
          taras={taras}
          salidasComunes={salidasComunes.filter(s => s.productoEntradaId === completando.productoEntradaId)}
          lotes={lotes}
          almacenes={almacenes}
          onClose={() => setCompletando(null)}
          onCompletada={() => { setCompletando(null); void cargar(); irAPestana('historial'); }}
        />
      )}
    </div>
  );
}

export default TransformacionesPage;
