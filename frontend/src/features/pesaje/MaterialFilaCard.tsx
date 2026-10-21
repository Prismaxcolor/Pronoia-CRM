import { AlertTriangle, Trash2 } from 'lucide-react';
import type { Lote, Producto, Tara } from '@shared/types/index.js';
import type { TipoPesajeBorrador } from '../../hooks/use-pesaje-borrador-context';
import BotonSelector from './BotonSelector';
import CantidadTaraInput from './CantidadTaraInput';
import FotoMaterialPicker from './FotoMaterialPicker';
import TarasExtraEditor from './TarasExtraEditor';
import { INPUT_CLASS, LABEL_CLASS } from './pesaje-clases';
import { avisoStockInsuficiente, formatearKgPesaje } from './pesaje-nuevo-logica';
import { esFilaSinLote, netoFila, taraKgFila, type MaterialFila } from './material-fila';

interface Props {
  fila: MaterialFila;
  numero: number;
  tipo: TipoPesajeBorrador;
  puedeQuitar: boolean;
  productos: Producto[];
  lotes: Lote[];
  taras: Tara[];
  /** Kg disponibles por material en el almacén de origen (traslado). */
  stockOrigen: Map<string, number>;
  /** Kg disponibles por material en todo el negocio (venta). */
  stockGlobalDisponible: Map<string, number>;
  onActivar: (uid: number) => void;
  onQuitar: (uid: number) => void;
  onCampo: (uid: number, campo: keyof MaterialFila, valor: string) => void;
  onTarasExtra: (uid: number, extras: NonNullable<MaterialFila['tarasExtra']>) => void;
  onElegirMaterial: (uid: number) => void;
  onElegirLote: (uid: number) => void;
  onElegirTara: (uid: number) => void;
  onAgregarFotos: (uid: number, files: File[]) => void;
  onQuitarFoto: (uid: number, idx: number) => void;
}

function AvisoStockMaterial({ texto }: { texto: string }) {
  return (
    <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
      <AlertTriangle size={13} className="shrink-0 mt-0.5" />
      <span>{texto}</span>
    </div>
  );
}

/** Aviso (sin bloquear) cuando el neto supera lo disponible: en traslado contra el almacén de origen, en venta contra el negocio. */
function AvisosDeStock({ fila: f, tipo, neto, stockOrigen, stockGlobalDisponible }: Pick<Props, 'fila' | 'tipo' | 'stockOrigen' | 'stockGlobalDisponible'> & { neto: number }) {
  if (!f.productoId) return null;
  if (tipo === 'traslado') {
    const aviso = avisoStockInsuficiente(neto, stockOrigen.get(f.productoId) ?? 0);
    if (!aviso) return null;
    return <AvisoStockMaterial texto={`El almacén de origen solo tiene ${formatearKgPesaje(aviso.disponible)} kg disponibles de este material — el inventario quedará en ${formatearKgPesaje(aviso.quedara)} kg.`} />;
  }
  if (tipo === 'venta') {
    const aviso = avisoStockInsuficiente(neto, stockGlobalDisponible.get(f.productoId) ?? 0);
    if (!aviso) return null;
    return <AvisoStockMaterial texto={`El negocio tiene ${formatearKgPesaje(aviso.disponible)} kg registrados de este material — el inventario quedará en ${formatearKgPesaje(aviso.quedara)} kg. Esto no impide la venta, es solo un aviso.`} />;
  }
  return null;
}

function SelectorModoTara({ fila: f, onCampo }: Pick<Props, 'fila' | 'onCampo'>) {
  const clase = (modo: MaterialFila['taraModo']) => `px-1 sm:px-2 py-1 truncate ${f.taraModo === modo ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`;
  return (
    <div className="flex rounded-md overflow-hidden border border-border text-[9px] sm:text-[11px] shrink-0 min-w-0">
      <button type="button" onClick={() => onCampo(f.uid, 'taraModo', 'preconfigurada')} className={clase('preconfigurada')}>
        Preconfigurada
      </button>
      <button type="button" onClick={() => onCampo(f.uid, 'taraModo', 'manual')} className={clase('manual')}>
        Manual
      </button>
    </div>
  );
}

function CampoTaraMaterial({ fila: f, taras, onCampo, onElegirTara }: Pick<Props, 'fila' | 'taras' | 'onCampo' | 'onElegirTara'>) {
  if (f.taraModo !== 'preconfigurada') {
    return <input type="number" step="0.001" min="0" value={f.taraManual} onChange={e => onCampo(f.uid, 'taraManual', e.target.value)} className={INPUT_CLASS} placeholder="0.00" />;
  }
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <BotonSelector
          elegido={!!f.taraId}
          texto={taras.find(t => t.id === f.taraId)?.nombre}
          placeholder="— Tara —"
          espaciado="gap-1"
          onClick={() => onElegirTara(f.uid)}
        />
        <CantidadTaraInput value={f.taraCantidad} onChange={v => onCampo(f.uid, 'taraCantidad', v)} />
      </div>
      <p className="text-[11px] text-text-muted mt-1">= {formatearKgPesaje(taraKgFila(f, taras))} kg</p>
    </div>
  );
}

function DestinoDelMaterial({ fila: f, tipo, productos, lotes, onElegirLote }: Pick<Props, 'fila' | 'tipo' | 'productos' | 'lotes' | 'onElegirLote'>) {
  if (esFilaSinLote(f, productos)) {
    return (
      <>
        <label className={LABEL_CLASS}>&nbsp;</label>
        <p className="text-xs text-text-muted bg-surface-alt border border-border rounded-lg px-3 py-2">
          Categoría sin lote — va directo a inventario general.
        </p>
      </>
    );
  }
  return (
    <>
      <label className={LABEL_CLASS}>{tipo === 'venta' ? 'Origen (inventario) *' : 'Destino (inventario) *'}</label>
      <BotonSelector elegido={!!f.destino} texto={lotes.find(l => l.id === f.destino)?.nombre} placeholder="— Selecciona —" onClick={() => onElegirLote(f.uid)} />
    </>
  );
}

/** Una fila de material del formulario "Nuevo pesaje": material, destino, tara, peso bruto, fotos y avisos de stock. */
function MaterialFilaCard(p: Props) {
  const { fila: f, tipo, taras } = p;
  const neto = netoFila(f, taras);
  return (
    <div
      onFocusCapture={() => p.onActivar(f.uid)}
      onClick={() => p.onActivar(f.uid)}
      className="border border-border rounded-lg p-3 space-y-3 bg-surface-alt/40"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-text-secondary">Material {p.numero}</span>
        {p.puedeQuitar && (
          <button type="button" onClick={() => p.onQuitar(f.uid)} className="text-text-muted hover:text-red-600 transition-colors" title="Quitar material">
            <Trash2 size={15} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className={tipo === 'traslado' ? 'col-span-2' : ''}>
          <label className={LABEL_CLASS}>Material *</label>
          <BotonSelector elegido={!!f.productoId} texto={p.productos.find(x => x.id === f.productoId)?.nombre} placeholder="— Selecciona —" onClick={() => p.onElegirMaterial(f.uid)} />
        </div>
        {tipo !== 'traslado' && (
          <div>
            <DestinoDelMaterial fila={f} tipo={tipo} productos={p.productos} lotes={p.lotes} onElegirLote={p.onElegirLote} />
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
          <SelectorModoTara fila={f} onCampo={p.onCampo} />
        </div>
        <label className="text-xs font-medium text-text-secondary">Peso bruto (kg)</label>

        <div className="self-start">
          <CampoTaraMaterial fila={f} taras={taras} onCampo={p.onCampo} onElegirTara={p.onElegirTara} />
        </div>
        <input type="number" step="0.001" min="0" value={f.pesoBruto} onChange={e => p.onCampo(f.uid, 'pesoBruto', e.target.value)} className={INPUT_CLASS + ' self-start'} placeholder="0.00" />
      </div>

      <TarasExtraEditor extras={f.tarasExtra ?? []} taras={taras} onChange={extras => p.onTarasExtra(f.uid, extras)} />

      <div className="flex items-center justify-end gap-2 text-sm">
        <span className="text-text-muted">Neto del material</span>
        <span className={`font-semibold ${neto < 0 ? 'text-red-600' : 'text-text-primary'}`}>{formatearKgPesaje(neto)} kg</span>
      </div>

      <FotoMaterialPicker fotos={f.fotos} onAgregar={files => p.onAgregarFotos(f.uid, files)} onQuitar={idx => p.onQuitarFoto(f.uid, idx)} />

      <AvisosDeStock fila={f} tipo={tipo} neto={neto} stockOrigen={p.stockOrigen} stockGlobalDisponible={p.stockGlobalDisponible} />
    </div>
  );
}

export default MaterialFilaCard;
