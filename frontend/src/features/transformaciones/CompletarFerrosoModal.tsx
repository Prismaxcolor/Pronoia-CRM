import { useState } from 'react';
import { X, Plus, Loader2 } from 'lucide-react';
import type { Almacen, Lote, Producto, SalidaComun, Tara, Transformacion } from '@shared/types/index.js';
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
import SalidaFerrosoFila from './SalidaFerrosoFila';
import { filasEfectivasFerroso, sanearFilasSalida, validarCompletarSalidas } from './completar-salidas-logica';
import { filaVacia, totalNetoSalidas, type FilaSalida } from './salidas-fila';

interface Props {
  transformacion: Transformacion;
  productos: Producto[];
  taras: Tara[];
  salidasComunes: SalidaComun[];
  lotes: Lote[];
  almacenes: Almacen[];
  onClose: () => void;
  onCompletada: () => void;
}

function CompletarFerrosoModal({ transformacion, productos, taras, salidasComunes, lotes, almacenes, onClose, onCompletada }: Props) {
  const toast = useToast();
  const comunesIds = salidasComunes.map(s => s.productoSalidaId);

  const filasIniciales = (): FilaSalida[] => (comunesIds.length > 0 ? comunesIds.map(id => filaVacia(id)) : [filaVacia()]);
  const [filas, setFilas] = useState<FilaSalida[]>(filasIniciales);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filaActivaUid, setFilaActivaUid] = useState<number | null>(null);
  const [mostrarSelectorMaterial, setMostrarSelectorMaterial] = useState(false);
  const [mostrarSelectorLote, setMostrarSelectorLote] = useState(false);
  const [avisoSaneo, setAvisoSaneo] = useState<string | null>(null);
  // Merma por tipo: opcional, no forma parte del borrador persistente.
  const [mermaForm, setMermaForm] = useState<MermaForm>(mermaFormVacio);
  // Observación opcional al completar: tampoco forma parte del borrador persistente.
  const [observacion, setObservacion] = useState('');
  // Las vistas previas de las fotos se liberan al cerrar el modal.
  useRevocarFotosAlDesmontar(filas.flatMap(f => f.fotos));

  const borrador = useBorradorPersistente<{ filas: FilaSalida[] }>({
    formulario: 'transformacion-completar',
    docId: transformacion.id,
    version: 1,
    estado: { filas },
    hayCambios: difiereEstado({ filas }, { filas: filasIniciales() }),
    aplicar: d => {
      // Material, lote, almacén o tara que ya no existen quedan sin elegir, con aviso.
      const r = sanearFilasSalida(d.filas, () => filaVacia(), {
        productoIds: productos.map(p => p.id),
        loteIds: lotes.filter(l => l.activo).map(l => l.id),
        almacenIds: almacenes.map(a => a.id),
        taraIds: taras.map(x => x.id),
      });
      setAvisoSaneo(r.aviso);
      setFilas(r.filas);
    },
    restablecer: () => { setFilas(filasIniciales()); setAvisoSaneo(null); },
  });
  // Cerrar (X o Cancelar) descarta el borrador guardado.
  const cerrar = () => { borrador.limpiar(); onClose(); };

  const actualizar = (uid: number, campo: Partial<FilaSalida>) => {
    setFilas(prev => prev.map(f => f.uid === uid ? { ...f, ...campo } : f));
  };
  const quitarFila = (uid: number) => {
    revocarFotos(filas.find(f => f.uid === uid)?.fotos ?? []);
    setFilas(prev => prev.filter(x => x.uid !== uid));
  };
  const elegirMaterial = (uid: number) => { setFilaActivaUid(uid); setMostrarSelectorMaterial(true); };
  const elegirLote = (uid: number) => { setFilaActivaUid(uid); setMostrarSelectorLote(true); };

  // Comunes primero para que sigan apareciendo destacados en la grilla visual.
  const productosOrdenados = [
    ...productos.filter(p => comunesIds.includes(p.id)),
    ...productos.filter(p => !comunesIds.includes(p.id)),
  ];

  const totalSalidas = totalNetoSalidas(filas, taras);
  const merma = transformacion.pesoNeto - totalSalidas;

  const handleCompletar = async () => {
    setError(null);
    // Salida a lote: el material que entra al lote es el de entrada de la transformación.
    const filasEfectivas = filasEfectivasFerroso(filas, transformacion.productoEntradaId);
    const errorValidacion = validarCompletarSalidas({
      categoria: 'ferroso_no_ferroso', filas: filasEfectivas, taras, contexto: { pesoEntrada: transformacion.pesoNeto }, mermaKg: merma, mermaForm,
    });
    if (errorValidacion) { setError(errorValidacion); return; }

    setGuardando(true);
    // En línea sube las fotos y completa; sin conexión guarda las salidas y sus fotos en el teléfono (cola).
    const variante = varianteDeCompletar('ferroso_no_ferroso', filasEfectivas);
    const result = await completarTransformacionF4(
      variante,
      transformacion,
      salidasParaCompletar(variante, 'ferroso_no_ferroso', filasEfectivas.map(f => ({ ...f, pesoBruto: Number(f.pesoBruto), tara: taraKgFila(f, taras) }))),
      armarMermaDetalle(mermaForm),
      observacion.trim() || undefined,
    );
    setGuardando(false);
    if ('error' in result) { setError(result.error); return; }
    if (result.enCola) toast.info('Salidas guardadas en el teléfono. La transformación se completará al volver la conexión.');
    else toast.exito('Transformación completada.');
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
              Entrada: <span className="font-medium">{transformacion.nombreProductoEntrada}</span> — {formatearKgPesaje(transformacion.pesoNeto)} kg
            </p>
          </div>
          <button onClick={cerrar} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
        </div>

        <AvisoBorrador className="mb-3" formulario="esta transformación" aviso={borrador.aviso} onDescartar={borrador.descartar} onCerrar={borrador.cerrarAviso} />
        <AvisoSaneoBorrador mensaje={avisoSaneo} />
        <div className="space-y-3 mb-4">
          {filas.map((f, idx) => (
            <SalidaFerrosoFila
              key={f.uid}
              fila={f}
              numero={idx + 1}
              puedeQuitar={filas.length > 1}
              productos={productos}
              taras={taras}
              lotes={lotes}
              onActualizar={actualizar}
              onQuitar={quitarFila}
              onElegirMaterial={elegirMaterial}
              onElegirLote={elegirLote}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => setFilas(prev => [...prev, filaVacia()])}
          className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-border rounded-lg text-sm text-text-muted hover:text-text-secondary hover:border-brand-400 transition-colors mb-4"
        >
          <Plus size={14} /> Agregar material de salida
        </button>

        <ResumenSalidasCard pesoEntrada={transformacion.pesoNeto} totalSalidas={totalSalidas} etiquetaResto="Merma" valorResto={merma} restoNegativo={merma < 0} />

        <div className="mb-4">
          <MermaPorTipoBloque mermaKg={merma} valores={mermaForm} onCambiar={setMermaForm} />
        </div>

        <ObservacionCierreCampo valor={observacion} onChange={setObservacion} />

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
          entidades={lotes.filter(l => l.activo).map(l => ({ id: l.id, nombre: `${l.nombre} — ${formatearKgPesaje(l.stockKg)} kg`, fotos: l.fotos }))}
          onClose={() => setMostrarSelectorLote(false)}
          onSeleccionar={id => { if (filaActivaUid != null) actualizar(filaActivaUid, { loteDestinoId: id }); setMostrarSelectorLote(false); }}
        />
      )}
    </div>
  );
}

export default CompletarFerrosoModal;
