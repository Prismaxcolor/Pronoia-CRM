import { Trash2 } from 'lucide-react';
import type { Almacen, Lote, Producto, Tara } from '@shared/types/index.js';
import FotoMaterialPicker from '../pesaje/FotoMaterialPicker';
import { conFotosAgregadas, quitarFotoLiberando } from '../pesaje/fotos-preview';
import { formatearKgPesaje } from '../pesaje/pesaje-nuevo-logica';
import CampoTaraSalida from './CampoTaraSalida';
import { BloqueLoteDestino, BloqueMaterialDestino, SelectorTipoSalida } from './SalidaMixtaFila';
import { INPUT_CLASS, LABEL_CLASS } from './clases-formulario';
import { netoSalida, type FilaSalidaPCB } from './salidas-fila';

const OPCIONES_TIPO_PCB = [
  { tipo: 'lote' as const, etiqueta: 'Lote' },
  { tipo: 'material' as const, etiqueta: 'Material' },
];

interface Props {
  fila: FilaSalidaPCB;
  numero: number;
  puedeQuitar: boolean;
  lotes: Lote[];
  almacenes: Almacen[];
  productos: Producto[];
  taras: Tara[];
  nombreAlmacenFijo: string | undefined;
  onActualizar: (uid: number, campos: Partial<FilaSalidaPCB>) => void;
  onQuitar: (uid: number) => void;
  onElegirMaterial: (uid: number) => void;
  onElegirLote: (uid: number) => void;
}

/** Una salida del formulario de completar una transformación PCB. */
function SalidaPCBFila(p: Props) {
  const { fila: f, taras, onActualizar } = p;
  const neto = netoSalida(f, taras);
  return (
    <div className="bg-surface-alt rounded-lg p-3 border border-border">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-text-secondary">Salida {p.numero}</span>
        {p.puedeQuitar && (
          <button type="button" onClick={() => p.onQuitar(f.uid)} className="text-text-muted hover:text-red-500">
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <div className="space-y-2">
        <SelectorTipoSalida valor={f.tipo} opciones={OPCIONES_TIPO_PCB} onCambiar={tipo => onActualizar(f.uid, { tipo })} />
        {f.tipo === 'lote' ? (
          <BloqueLoteDestino
            lote={p.lotes.find(l => l.id === f.loteDestinoId)}
            onElegirLote={() => p.onElegirLote(f.uid)}
          />
        ) : (
          <BloqueMaterialDestino
            nombreProducto={p.productos.find(x => x.id === f.productoId)?.nombre}
            almacenId={f.almacenId}
            almacenes={p.almacenes}
            onElegirProducto={() => p.onElegirMaterial(f.uid)}
            onCambiarAlmacen={almacenId => onActualizar(f.uid, { almacenId })}
            almacenFijoNombre={p.nombreAlmacenFijo}
          />
        )}
        <div>
          <label className={LABEL_CLASS}>Peso bruto de salida (kg) *</label>
          <input type="number" step="0.001" min="0.001" value={f.pesoBruto}
            onChange={e => onActualizar(f.uid, { pesoBruto: e.target.value })} className={INPUT_CLASS} placeholder="0.00" />
        </div>
        <CampoTaraSalida valor={f} taras={taras} onCambiar={campos => onActualizar(f.uid, campos)} />
        <p className="text-xs text-text-muted">Neto: <span className="font-semibold text-text-primary">{formatearKgPesaje(neto)} kg</span></p>
        <FotoMaterialPicker
          label="Fotos de esta salida (opcional)"
          fotos={f.fotos}
          onAgregar={files => onActualizar(f.uid, { fotos: conFotosAgregadas(f.fotos, files) })}
          onQuitar={idx => onActualizar(f.uid, { fotos: quitarFotoLiberando(f.fotos, idx) })}
        />
      </div>
    </div>
  );
}

export default SalidaPCBFila;
