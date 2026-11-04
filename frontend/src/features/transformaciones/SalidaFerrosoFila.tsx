import { ChevronDown, Trash2 } from 'lucide-react';
import type { Lote, Producto, Tara } from '@shared/types/index.js';
import FotoMaterialPicker from '../pesaje/FotoMaterialPicker';
import { conFotosAgregadas, quitarFotoLiberando } from '../pesaje/fotos-preview';
import { formatearKgPesaje } from '../pesaje/pesaje-nuevo-logica';
import CampoTaraSalida from './CampoTaraSalida';
import { BloqueLoteDestino, SelectorTipoSalida } from './SalidaMixtaFila';
import { INPUT_CLASS, LABEL_CLASS } from './clases-formulario';
import { netoSalida, type FilaSalida } from './salidas-fila';

const OPCIONES_TIPO_FERROSO = [
  { tipo: 'material' as const, etiqueta: 'Material' },
  { tipo: 'lote' as const, etiqueta: 'Lote' },
];

interface Props {
  fila: FilaSalida;
  numero: number;
  puedeQuitar: boolean;
  productos: Producto[];
  taras: Tara[];
  lotes: Lote[];
  onActualizar: (uid: number, campos: Partial<FilaSalida>) => void;
  onQuitar: (uid: number) => void;
  onElegirMaterial: (uid: number) => void;
  onElegirLote: (uid: number) => void;
}

/** Una salida del formulario de completar una transformación ferroso. */
function SalidaFerrosoFila({ fila: f, numero, puedeQuitar, productos, taras, lotes, onActualizar, onQuitar, onElegirMaterial, onElegirLote }: Props) {
  const neto = netoSalida(f, taras);
  return (
    <div className="bg-surface-alt rounded-lg p-3 border border-border">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-text-secondary">Salida {numero}</span>
        {puedeQuitar && (
          <button type="button" onClick={() => onQuitar(f.uid)} className="text-text-muted hover:text-red-500">
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <div className="space-y-2">
        <SelectorTipoSalida valor={f.tipo} opciones={OPCIONES_TIPO_FERROSO} onCambiar={tipo => onActualizar(f.uid, { tipo })} />
        {f.tipo === 'material' && (
          <div>
            <label className={LABEL_CLASS}>Material *</label>
            <button
              type="button"
              onClick={() => onElegirMaterial(f.uid)}
              className={`${INPUT_CLASS} flex items-center justify-between gap-2 text-left`}
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
            onElegirLote={() => onElegirLote(f.uid)}
          />
        )}
        <div>
          <label className={LABEL_CLASS}>Peso bruto (kg) *</label>
          <input type="number" step="0.001" min="0.001" value={f.pesoBruto}
            onChange={e => onActualizar(f.uid, { pesoBruto: e.target.value })}
            className={INPUT_CLASS} placeholder="0.00" />
        </div>
        <CampoTaraSalida valor={f} taras={taras} onCambiar={campos => onActualizar(f.uid, campos)} />
        <p className="text-xs text-text-muted">
          Neto: <span className="font-semibold text-text-primary">{formatearKgPesaje(neto)} kg</span>
        </p>
        <FotoMaterialPicker
          label="Fotos de esta salida"
          fotos={f.fotos}
          onAgregar={files => onActualizar(f.uid, { fotos: conFotosAgregadas(f.fotos, files) })}
          onQuitar={idx => onActualizar(f.uid, { fotos: quitarFotoLiberando(f.fotos, idx) })}
        />
      </div>
    </div>
  );
}

export default SalidaFerrosoFila;
