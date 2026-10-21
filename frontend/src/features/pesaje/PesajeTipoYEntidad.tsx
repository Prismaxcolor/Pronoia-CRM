import type { Almacen } from '@shared/types/index.js';
import type { TipoPesajeBorrador } from '../../hooks/use-pesaje-borrador-context';
import BotonSelector from './BotonSelector';
import { INPUT_CLASS, LABEL_CLASS } from './pesaje-clases';
import type { EntidadPesaje } from './pesaje-nuevo-logica';

interface TipoProps {
  tipo: TipoPesajeBorrador;
  setTipo: (tipo: TipoPesajeBorrador) => void;
  setEntidadId: (id: string) => void;
  setPesajeExterior: (valor: boolean) => void;
}

const CLASE_BASE_TIPO = 'flex-1 sm:flex-none px-2 sm:px-4 py-1.5 text-center';
const claseTipo = (activo: boolean) => `${CLASE_BASE_TIPO} ${activo ? 'bg-brand-600 text-white' : 'bg-surface-alt text-text-secondary'}`;

/** Interruptor compra / venta / traslado. */
export function ToggleTipoOperacion({ tipo, setTipo, setEntidadId, setPesajeExterior }: TipoProps) {
  return (
    <div>
      <label className={LABEL_CLASS}>Tipo de operación</label>
      <div className="flex rounded-lg overflow-hidden border border-border text-sm w-full sm:w-fit">
        <button type="button" onClick={() => { setTipo('compra'); setEntidadId(''); }} className={claseTipo(tipo === 'compra')}>
          Compra <span className="hidden sm:inline">(proveedor)</span>
        </button>
        <button type="button" onClick={() => { setTipo('venta'); setEntidadId(''); setPesajeExterior(false); }} className={claseTipo(tipo === 'venta')}>
          Venta <span className="hidden sm:inline">(cliente)</span>
        </button>
        <button type="button" onClick={() => { setTipo('traslado'); setEntidadId(''); setPesajeExterior(false); }} className={claseTipo(tipo === 'traslado')}>
          Traslado <span className="hidden sm:inline">(almacén)</span>
        </button>
      </div>
    </div>
  );
}

interface EncabezadoProps {
  tipo: TipoPesajeBorrador;
  almacenes: Almacen[];
  almacenOrigenId: string;
  almacenDestinoId: string;
  entidades: EntidadPesaje[];
  entidadId: string;
  labelEntidad: string;
  fecha: string;
  setFecha: (fecha: string) => void;
  onElegirAlmacenOrigen: () => void;
  onElegirAlmacenDestino: () => void;
  onElegirEntidad: () => void;
}

/** Traslado: almacén de origen y destino. Compra/venta: proveedor o cliente y fecha. */
export function EncabezadoPesaje(p: EncabezadoProps) {
  if (p.tipo === 'traslado') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL_CLASS}>Almacén origen *</label>
          <BotonSelector elegido={!!p.almacenOrigenId} texto={p.almacenes.find(a => a.id === p.almacenOrigenId)?.nombre} placeholder="— Selecciona —" onClick={p.onElegirAlmacenOrigen} />
        </div>
        <div>
          <label className={LABEL_CLASS}>Almacén destino *</label>
          <BotonSelector elegido={!!p.almacenDestinoId} texto={p.almacenes.find(a => a.id === p.almacenDestinoId)?.nombre} placeholder="— Selecciona —" onClick={p.onElegirAlmacenDestino} />
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className={LABEL_CLASS}>{p.labelEntidad} *</label>
        <BotonSelector elegido={!!p.entidadId} texto={p.entidades.find(e => e.id === p.entidadId)?.nombre} placeholder="— Selecciona —" onClick={p.onElegirEntidad} />
      </div>
      <div>
        <label className={LABEL_CLASS}>Fecha</label>
        <input type="date" value={p.fecha} onChange={e => p.setFecha(e.target.value)} className={INPUT_CLASS} />
      </div>
    </div>
  );
}
