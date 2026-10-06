import { ChevronDown } from 'lucide-react';
import type { Almacen, EntradaDetalleTransformacion, Lote } from '@shared/types/index.js';
import { proyectarComposicion, type TipoSalida } from '../../lib/salida-mixta';

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
}: {
  nombreProducto: string | undefined;
  almacenId: string;
  almacenes: Almacen[];
  onElegirProducto: () => void;
  onCambiarAlmacen: (id: string) => void;
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
      <SelectorAlmacen
        etiqueta="Almacén de destino *"
        placeholder="-Selecciona dónde queda este material-"
        almacenId={almacenId}
        almacenes={almacenes}
        onCambiar={onCambiarAlmacen}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Salida a LOTE: lote destino + almacén + composición (PCB y ferroso)
// ---------------------------------------------------------------------------
function ComposicionLote({
  lote,
  almacenId,
  entradaDetalle,
  neto,
}: {
  lote: Lote;
  almacenId: string;
  entradaDetalle: EntradaDetalleTransformacion[];
  neto: number;
}) {
  // La composición es POR (lote, almacén) — la de este destino en OTRO
  // almacén no se muestra ni se toca.
  const enAlmacen = lote.stockPorAlmacen.find(s => s.almacenId === almacenId);
  const compDestino = enAlmacen?.composicion ?? [];
  const proyeccion = proyectarComposicion(enAlmacen?.stockKg ?? 0, compDestino, entradaDetalle, neto);
  return (
    <>
      {compDestino.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          <span className="text-[10px] text-text-muted w-full mb-0.5">Composición actual del destino en este almacén:</span>
          {compDestino.map(c => (
            <span key={c.item} className="text-[11px] bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5">
              {c.item}: {c.porcentaje}%
            </span>
          ))}
        </div>
      )}
      {proyeccion.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          <span className="text-[10px] text-text-muted w-full mb-0.5">Composición estimada después de esta transformación:</span>
          {proyeccion.map(c => (
            <span
              key={c.item}
              className={`text-[11px] border rounded-full px-2 py-0.5 ${
                c.esNuevo ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200'
              }`}
              title={c.esNuevo ? 'Material nuevo en este lote en este almacén' : undefined}
            >
              {c.esNuevo && '★ '}{c.item}: {c.porcentaje}%
            </span>
          ))}
        </div>
      )}
    </>
  );
}

export function BloqueLoteDestino({
  lote,
  almacenId,
  entradaDetalle,
  neto,
  onElegirLote,
}: {
  lote: Lote | undefined;
  /** Almacén donde quedará (el de la transformación): solo para la vista previa de composición; no se elige. */
  almacenId: string | null;
  /** Composición de lo que entra a este lote (PCB: la congelada de la
   *  transformación; ferroso: el material de la fila al 100%). */
  entradaDetalle: EntradaDetalleTransformacion[];
  neto: number;
  onElegirLote: () => void;
}) {
  return (
    <>
      <div>
        <label className={LABEL_CLASS}>Lote de destino *</label>
        <button type="button" onClick={onElegirLote} className={`${INPUT_CLASS} flex items-center justify-between gap-2 text-left`}>
          <span className={lote ? 'text-text-primary truncate' : 'text-text-muted'}>
            {lote?.nombre ?? '-Selecciona el lote de destino-'}
          </span>
          <ChevronDown size={14} className="text-text-muted shrink-0" />
        </button>
      </div>
      {lote && almacenId && (
        <ComposicionLote lote={lote} almacenId={almacenId} entradaDetalle={entradaDetalle} neto={neto} />
      )}
    </>
  );
}
