import { Plus, Trash2 } from 'lucide-react';
import FotoMaterialPicker from './FotoMaterialPicker';
import { INPUT_CLASS, LABEL_CLASS } from './pesaje-clases';
import { formatearKgPesaje } from './pesaje-nuevo-logica';
import { netoPesajeGlobalFila, sumaPesajesGlobales, type PesajeGlobalFila } from './pesaje-global-fila';

interface Props {
  tipo: 'compra' | 'venta';
  pesajeExterior: boolean;
  setPesajeExterior: (valor: boolean) => void;
  sinPesajeGlobal: boolean;
  pesajesGlobales: PesajeGlobalFila[];
  onAgregar: () => void;
  onQuitar: (uid: number) => void;
  onCampo: (uid: number, campo: 'peso' | 'tara', valor: string) => void;
  onAgregarFotos: (uid: number, files: File[]) => void;
  onQuitarFoto: (uid: number, idx: number) => void;
}

function CampoKg({ etiqueta, valor, onChange }: { etiqueta: string; valor: string; onChange: (valor: string) => void }) {
  return (
    <div>
      <label className={LABEL_CLASS}>{etiqueta}</label>
      <input
        type="number" step="0.001" min="0"
        value={valor}
        onChange={e => onChange(e.target.value)}
        className={INPUT_CLASS}
        placeholder="0.000"
      />
    </div>
  );
}

function PesadaGlobalCard({ fila: f, numero, puedeQuitar, p }: { fila: PesajeGlobalFila; numero: number; puedeQuitar: boolean; p: Props }) {
  const neto = netoPesajeGlobalFila(f);
  return (
    <div className="border border-border rounded-lg p-3 space-y-2 bg-surface-alt/40">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-text-secondary">Pesaje {numero}</span>
        {puedeQuitar && (
          <button type="button" onClick={() => p.onQuitar(f.uid)} className="text-text-muted hover:text-red-600 transition-colors" title="Quitar pesaje">
            <Trash2 size={15} />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <CampoKg etiqueta="Peso bruto (kg)" valor={f.peso} onChange={v => p.onCampo(f.uid, 'peso', v)} />
        <CampoKg etiqueta="Tara (kg)" valor={f.tara} onChange={v => p.onCampo(f.uid, 'tara', v)} />
      </div>
      <div className="flex items-center justify-end gap-2 text-sm">
        <span className="text-text-muted">Neto</span>
        <span className={`font-semibold ${neto < 0 ? 'text-red-600' : 'text-text-primary'}`}>{formatearKgPesaje(neto)} kg</span>
      </div>
      <FotoMaterialPicker
        label="Fotos del pesaje"
        fotos={f.fotos}
        onAgregar={files => p.onAgregarFotos(f.uid, files)}
        onQuitar={idx => p.onQuitarFoto(f.uid, idx)}
      />
    </div>
  );
}

/** Pesaje global de una compra o venta: casilla de peso exterior y las pesadas del camión. */
function PesajeGlobalSeccion(p: Props) {
  return (
    <div>
      <label className="flex items-center gap-2 mb-4 text-sm font-medium text-text-primary cursor-pointer">
        <input
          type="checkbox"
          checked={p.pesajeExterior}
          onChange={e => p.setPesajeExterior(e.target.checked)}
          className="rounded border-border"
        />
        Peso exterior (sin pesaje global)
      </label>
      <h3 className="text-lg font-bold text-text-primary mb-2">Pesaje global {p.sinPesajeGlobal ? '' : '*'}</h3>
      {p.sinPesajeGlobal ? (
        <p className="text-xs text-text-muted">Sin pesaje global: {p.tipo === 'venta' ? 'la venta' : 'la compra'} se registra con el peso exterior, sin peso global para reconciliar.</p>
      ) : (
        <div className="space-y-2">
          {p.pesajesGlobales.map((f, idx) => (
            <PesadaGlobalCard key={f.uid} fila={f} numero={idx + 1} puedeQuitar={p.pesajesGlobales.length > 1} p={p} />
          ))}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={p.onAgregar}
              className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors"
            >
              <Plus size={16} />
              Agregar pesaje
            </button>
            {p.pesajesGlobales.length > 1 && (
              <span className="text-xs text-text-secondary">
                Total: <span className="font-semibold text-text-primary">{formatearKgPesaje(sumaPesajesGlobales(p.pesajesGlobales))} kg</span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default PesajeGlobalSeccion;
