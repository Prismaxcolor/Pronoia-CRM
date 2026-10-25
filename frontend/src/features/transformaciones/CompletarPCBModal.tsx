import { useState } from 'react';
import { X, Plus, Loader2 } from 'lucide-react';
import type { Almacen, Lote, Producto, Tara, Transformacion } from '@shared/types/index.js';
import { useToast } from '../../hooks/use-toast-context';
import { useBorradorPersistente } from '../../hooks/use-borrador-persistente';
import { difiereEstado } from '../../lib/borrador';
import { armarMermaDetalle, mermaFormVacio, type MermaForm } from '../../lib/merma-tipificada';
import { completarTransformacionF4 } from '../../services/transformacion-cola';
import { salidasParaCompletar, varianteDeCompletar } from '../../lib/offline/f4/salidas-f4';
import AvisoBorrador from '../../components/AvisoBorrador';
import SeleccionarEntidadModal from '../../components/SeleccionarEntidadModal';
import SeleccionarMaterialModal from '../pesaje/SeleccionarMaterialModal';
import { taraKgFila } from '../pesaje/material-fila';
import { formatearKgPesaje } from '../pesaje/pesaje-nuevo-logica';
import { revocarFotos } from '../pesaje/fotos-preview';
import { useRevocarFotosAlDesmontar } from '../pesaje/use-revocar-fotos';
import MermaPorTipoBloque from './MermaPorTipoBloque';
import ObservacionCierreCampo from './ObservacionCierreCampo';
import AvisoSaneoBorrador from './AvisoSaneoBorrador';
import ResumenSalidasCard from './ResumenSalidasCard';
import SalidaPCBFila from './SalidaPCBFila';
import { filasEfectivasPCB, sanearFilasSalida, validarCompletarSalidas } from './completar-salidas-logica';
import { filaSalidaPCBVacia, totalNetoSalidas, type FilaSalidaPCB } from './salidas-fila';

interface Props {
  transformacion: Transformacion;
  lotes: Lote[];
  almacenes: Almacen[];
  productos: Producto[];
  taras: Tara[];
  onClose: () => void;
  onCompletada: () => void;
}

function CompletarPCBModal({ transformacion, lotes, almacenes, productos, taras, onClose, onCompletada }: Props) {
  const toast = useToast();

  const [filas, setFilas] = useState<FilaSalidaPCB[]>(() => [filaSalidaPCBVacia()]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filaActivaUid, setFilaActivaUid] = useState<number | null>(null);
  const [mostrarSelectorLote, setMostrarSelectorLote] = useState(false);
  const [mostrarSelectorMaterial, setMostrarSelectorMaterial] = useState(false);
  const [avisoSaneo, setAvisoSaneo] = useState<string | null>(null);
  // Merma por tipo: opcional, no forma parte del borrador persistente.
  const [mermaForm, setMermaForm] = useState<MermaForm>(mermaFormVacio);
  // Observación opcional al completar: tampoco forma parte del borrador persistente.
  const [observacion, setObservacion] = useState('');
  // Las vistas previas de las fotos se liberan al cerrar el modal.
  useRevocarFotosAlDesmontar(filas.flatMap(f => f.fotos));

  const borrador = useBorradorPersistente<{ filas: FilaSalidaPCB[] }>({
    formulario: 'transformacion-completar-pcb',
    docId: transformacion.id,
    // v2: la tara dejó de ser un texto único (`tara`) y pasó a taraModo/taraId/taraCantidad/taraManual;
    // los borradores v1 se descartan en vez de restaurarse con la tara perdida.
    version: 2,
    estado: { filas },
    hayCambios: difiereEstado({ filas }, { filas: [filaSalidaPCBVacia()] }),
    aplicar: d => {
      // Material, lote, almacén o tara que ya no existen quedan sin elegir, con aviso.
      const r = sanearFilasSalida(d.filas, filaSalidaPCBVacia, {
        productoIds: productos.map(p => p.id),
        loteIds: lotes.filter(l => l.activo).map(l => l.id),
        almacenIds: almacenes.map(a => a.id),
        taraIds: taras.map(x => x.id),
      });
      setAvisoSaneo(r.aviso);
      setFilas(r.filas);
    },
    restablecer: () => { setFilas([filaSalidaPCBVacia()]); setAvisoSaneo(null); },
  });
  // Cerrar (X o Cancelar) descarta el borrador guardado.
  const cerrar = () => { borrador.limpiar(); onClose(); };

  const actualizar = (uid: number, campo: Partial<FilaSalidaPCB>) => {
    setFilas(prev => prev.map(f => f.uid === uid ? { ...f, ...campo } : f));
  };
  const quitarFila = (uid: number) => {
    revocarFotos(filas.find(f => f.uid === uid)?.fotos ?? []);
    setFilas(prev => prev.filter(x => x.uid !== uid));
  };
  const elegirMaterial = (uid: number) => { setFilaActivaUid(uid); setMostrarSelectorMaterial(true); };
  const elegirLote = (uid: number) => { setFilaActivaUid(uid); setMostrarSelectorLote(true); };

  const totalSalidas = totalNetoSalidas(filas, taras);
  const restante = transformacion.pesoNeto - totalSalidas;
  // El material suelto sale al mismo almacén con el que se inició (solo se pregunta en transformaciones antiguas sin almacén).
  const almacenFijo = transformacion.almacenId ?? '';
  const nombreAlmacenFijo = almacenFijo ? (almacenes.find(a => a.id === almacenFijo)?.nombre ?? 'Almacén de inicio') : undefined;

  const handleCompletar = async () => {
    setError(null);
    const filasEfectivas = filasEfectivasPCB(filas, almacenFijo);
    const errorValidacion = validarCompletarSalidas({
      categoria: 'pcb', filas: filasEfectivas, taras,
      contexto: { loteOrigenId: transformacion.loteOrigenId, pesoEntrada: transformacion.pesoNeto },
      mermaKg: restante, mermaForm,
    });
    if (errorValidacion) { setError(errorValidacion); return; }

    setGuardando(true);
    // En línea sube las fotos y completa; sin conexión guarda las salidas y sus fotos en el teléfono (cola).
    const variante = varianteDeCompletar('pcb', filasEfectivas);
    const result = await completarTransformacionF4(
      variante,
      transformacion,
      salidasParaCompletar(variante, 'pcb', filasEfectivas.map(f => ({ ...f, pesoBruto: Number(f.pesoBruto), tara: taraKgFila(f, taras) }))),
      armarMermaDetalle(mermaForm),
      observacion.trim() || undefined,
    );
    setGuardando(false);
    if ('error' in result) { setError(result.error); return; }
    if (result.enCola) toast.info('Salidas guardadas en el teléfono. La transformación PCB se completará al volver la conexión.');
    else toast.exito('Transformación PCB completada.');
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
              Origen: <span className="font-medium">{transformacion.nombreLoteOrigen ?? '—'}</span> — {formatearKgPesaje(transformacion.pesoNeto)} kg
            </p>
          </div>
          <button onClick={cerrar} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
        </div>

        <AvisoBorrador className="mb-3" formulario="esta transformación" aviso={borrador.aviso} onDescartar={borrador.descartar} onCerrar={borrador.cerrarAviso} />
        <AvisoSaneoBorrador mensaje={avisoSaneo} />
        <div className="space-y-3 mb-4">
          {filas.map((f, idx) => (
            <SalidaPCBFila
              key={f.uid}
              fila={f}
              numero={idx + 1}
              puedeQuitar={filas.length > 1}
              lotes={lotes}
              almacenes={almacenes}
              productos={productos}
              taras={taras}
              nombreAlmacenFijo={nombreAlmacenFijo}
              onActualizar={actualizar}
              onQuitar={quitarFila}
              onElegirMaterial={elegirMaterial}
              onElegirLote={elegirLote}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => setFilas(prev => [...prev, filaSalidaPCBVacia()])}
          className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-border rounded-lg text-sm text-text-muted hover:text-text-secondary hover:border-brand-400 transition-colors mb-4"
        >
          <Plus size={14} /> Agregar salida
        </button>

        <ResumenSalidasCard
          pesoEntrada={transformacion.pesoNeto}
          totalSalidas={totalSalidas}
          etiquetaResto={restante < 0 ? 'Excedente' : 'Restante'}
          valorResto={Math.abs(restante)}
          restoNegativo={restante < 0}
        />

        <div className="mb-4">
          <MermaPorTipoBloque mermaKg={restante} valores={mermaForm} onCambiar={setMermaForm} />
        </div>

        <ObservacionCierreCampo valor={observacion} onChange={setObservacion} />

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
            entidades={lotes.filter(l => l.activo && l.id !== transformacion.loteOrigenId).map(l => ({ id: l.id, nombre: `${l.nombre} — ${formatearKgPesaje(l.stockKg)} kg`, fotos: l.fotos }))}
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

export default CompletarPCBModal;
