import { ChevronDown } from 'lucide-react';
import type { Almacen, Lote } from '@shared/types/index.js';
import type { TipoSalida } from '../../lib/salida-mixta';

const INPUT_CLASS = 'w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400';
const LABEL_CLASS = 'block text-xs font-medium text-text-secondary mb-1';

// ---------------------------------------------------------------------------
// Selector "Material | Lote" de una fila de salida
// ---------------------------------------------------------------------------
export function SelectorTipoSalida({
  valor,
  opciones,
  onCambiar,
}: {
  valor: TipoSalida;
  opciones: ReadonlyArray<{ tipo: TipoSalida; etiqueta: string }>;
  onCambiar: (tipo: TipoSalida) => void;
}) {
  return (
    <div>
      <label className={LABEL_CLASS}>Tipo de salida</label>
      <div className="flex rounded-md overflow-hidden border border-border text-[11px] w-fit">
        {opciones.map(o => (
          <button
            key={o.tipo}
            type="button"
            onClick={() => onCambiar(o.tipo)}
            className={`px-3 py-1 ${valor === o.tipo ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}
          >
            {o.etiqueta}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Selector de almacén (solo salidas a material: el lote no pide almacén)
// ---------------------------------------------------------------------------
function SelectorAlmacen({
  etiqueta,
  placeholder,
  almacenId,
  almacenes,
  onCambiar,
}: {
  etiqueta: string;
  placeholder: string;
  almacenId: string;
  almacenes: Almacen[];
  onCambiar: (id: string) => void;
}) {
  return (
    <div>
      <label className={LABEL_CLASS}>{etiqueta}</label>
      <select required value={almacenId} onChange={e => onCambiar(e.target.value)} className={INPUT_CLASS}>
        <option value="" disabled>{placeholder}</option>
        {almacenes.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Salida a MATERIAL: producto + almacén (usado en PCB)
// ---------------------------------------------------------------------------
export function BloqueMaterialDestino({
  nombreProducto,
  almacenId,
  almacenes,
  onElegirProducto,
  onCambiarAlmacen,
  almacenFijoNombre,
}: {
  nombreProducto: string | undefined;
  almacenId: string;
  almacenes: Almacen[];
  onElegirProducto: () => void;
  onCambiarAlmacen: (id: string) => void;
  /** Nombre del almacén con el que se inició la transformación: si viene, el material queda
   *  ahí y el almacén se muestra bloqueado en vez de pedirlo otra vez. */
  almacenFijoNombre?: string;
}) {
  return (
    <>
      <div>
        <label className={LABEL_CLASS}>Material *</label>
        <button type="button" onClick={onElegirProducto} className={`${INPUT_CLASS} flex items-center justify-between gap-2 text-left`}>
          <span className={nombreProducto ? 'text-text-primary truncate' : 'text-text-muted'}>
            {nombreProducto ?? '-Selecciona el material-'}
          </span>
          <ChevronDown size={14} className="text-text-muted shrink-0" />
        </button>
      </div>
      {almacenFijoNombre ? (
        <div>
          <label className={LABEL_CLASS}>Almacén de destino</label>
          <p className={`${INPUT_CLASS} text-text-secondary`}>{almacenFijoNombre} <span className="text-[11px] text-text-muted">(el de inicio)</span></p>
        </div>
      ) : (
        <SelectorAlmacen
          etiqueta="Almacén de destino *"
          placeholder="-Selecciona dónde queda este material-"
          almacenId={almacenId}
          almacenes={almacenes}
          onCambiar={onCambiarAlmacen}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Salida a LOTE: solo el lote destino (la composición no se muestra al pesar los resultados)
// ---------------------------------------------------------------------------
export function BloqueLoteDestino({ lote, onElegirLote }: { lote: Lote | undefined; onElegirLote: () => void }) {
  return (
    <div>
      <label className={LABEL_CLASS}>Lote de destino *</label>
      <button type="button" onClick={onElegirLote} className={`${INPUT_CLASS} flex items-center justify-between gap-2 text-left`}>
        <span className={lote ? 'text-text-primary truncate' : 'text-text-muted'}>
          {lote?.nombre ?? '-Selecciona el lote de destino-'}
        </span>
        <ChevronDown size={14} className="text-text-muted shrink-0" />
      </button>
    </div>
  );
}
