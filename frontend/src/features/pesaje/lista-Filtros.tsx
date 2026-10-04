import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { ControlSegmentado } from '../../components/ui';
import type { ValoresFiltros } from '../../lib/filtros-url';
import { TIPOS_FILTRO, contarFiltrosPesaje, type EstadoFiltro, type FiltrosPesaje, type TipoFiltro } from '../../lib/pesaje-lista';

/** Barra de filtros de la lista de Tickets. Tiene el mismo estilo que <FiltrosBarra> del kit, pero con dos diferencias:
 *  (1) el rango de fechas NO trae un atajo "30 días" activo por defecto: sin fechas se ven TODOS los tickets (un ticket en bruto
 *  viejo no puede desaparecer de la lista), y (2) el estado va como control segmentado con conteos. El estado vive en la URL. */

const ETIQUETAS_TIPO: Record<TipoFiltro, string> = { compra: 'Compra', venta: 'Venta', traslado: 'Traslado' };
const RETARDO_BUSCADOR_MS = 350;

const campo = 'px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';
const etiquetaCampo = 'block text-xs font-medium text-text-secondary mb-1';

export interface ConteosEstado { todos: number; bruto: number; pendiente: number; facturado: number }

interface Props {
  filtros: FiltrosPesaje;
  conteos: ConteosEstado;
  entidades: ReadonlyArray<{ id: string; nombre: string }>;
  onCambiar: (cambios: ValoresFiltros) => void;
  onLimpiar: () => void;
}

type EstadoUi = 'todos' | EstadoFiltro;

/** Buscador con retardo (no reescribe la URL en cada tecla) que sigue a la URL si cambia por fuera ("Limpiar", atrás). */
function BuscadorCodigo({ valor, onCambiar }: { valor?: string; onCambiar: (v: string | undefined) => void }) {
  const [texto, setTexto] = useState(valor ?? '');
  useEffect(() => {
    if ((valor ?? '') === texto.trim()) return;
    const t = setTimeout(() => onCambiar(texto.trim() || undefined), RETARDO_BUSCADOR_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo reaccionamos al texto escrito.
  }, [texto]);
  const [valorPrevio, setValorPrevio] = useState(valor);
  if (valorPrevio !== valor) {
    setValorPrevio(valor);
    if ((valor ?? '') !== texto.trim()) setTexto(valor ?? '');
  }
  return (
    <div className="min-w-[12rem] basis-full flex-1 sm:basis-0">
      <label htmlFor="pesaje-q" className={etiquetaCampo}>N° de control</label>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" />
        <input id="pesaje-q" type="search" value={texto} onChange={e => setTexto(e.target.value)} placeholder="Ej.: 58 o compra-0058" className={`${campo} w-full pl-9`} />
      </div>
    </div>
  );
}

function ListaFiltros({ filtros, conteos, entidades, onCambiar, onLimpiar }: Props) {
  const activos = contarFiltrosPesaje(filtros);
  const estadoUi: EstadoUi = filtros.estado ?? 'todos';

  return (
    <div className="mb-4 rounded-xl border border-border bg-surface p-3 sm:p-4 print:hidden">
      <div className="mb-3">
        <span className={etiquetaCampo}>Estado</span>
        <ControlSegmentado<EstadoUi>
          etiquetaAria="Estado de los tickets"
          valor={estadoUi}
          onCambiar={v => onCambiar({ estado: v === 'todos' ? undefined : v })}
          opciones={[
            { valor: 'todos', etiqueta: 'Todos', sufijo: conteos.todos },
            { valor: 'bruto', etiqueta: 'Por recepcionar', sufijo: conteos.bruto },
            { valor: 'pendiente', etiqueta: 'Por facturar', sufijo: conteos.pendiente },
            { valor: 'facturado', etiqueta: 'Facturados', sufijo: conteos.facturado },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="min-w-[9rem] flex-1 sm:flex-none">
          <label htmlFor="pesaje-tipo" className={etiquetaCampo}>Tipo</label>
          <select id="pesaje-tipo" value={filtros.tipo ?? ''} onChange={e => onCambiar({ tipo: e.target.value || undefined })} className={`${campo} w-full`}>
            <option value="">Todos</option>
            {TIPOS_FILTRO.map(t => <option key={t} value={t}>{ETIQUETAS_TIPO[t]}</option>)}
          </select>
        </div>
        <div className="min-w-[10rem] flex-1 sm:flex-none">
          <label htmlFor="pesaje-entidad" className={etiquetaCampo}>Proveedor o cliente</label>
          <select id="pesaje-entidad" value={filtros.entidad ?? ''} onChange={e => onCambiar({ entidad: e.target.value || undefined })} className={`${campo} w-full`}>
            <option value="">Todos</option>
            {entidades.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </div>
        <div className="min-w-[8.5rem] flex-1 sm:flex-none">
          <label htmlFor="pesaje-desde" className={etiquetaCampo}>Desde</label>
          <input id="pesaje-desde" type="date" value={filtros.desde ?? ''} max={filtros.hasta} onChange={e => onCambiar({ desde: e.target.value || undefined })} className={`${campo} w-full`} />
        </div>
        <div className="min-w-[8.5rem] flex-1 sm:flex-none">
          <label htmlFor="pesaje-hasta" className={etiquetaCampo}>Hasta</label>
          <input id="pesaje-hasta" type="date" value={filtros.hasta ?? ''} min={filtros.desde} onChange={e => onCambiar({ hasta: e.target.value || undefined })} className={`${campo} w-full`} />
        </div>
        <BuscadorCodigo valor={filtros.q} onCambiar={q => onCambiar({ q })} />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" checked={filtros.dif} onChange={e => onCambiar({ dif: e.target.checked })} className="h-4 w-4 rounded border-border-strong accent-brand-600" />
          Solo con diferencia de peso fuera de tolerancia
        </label>
        {activos > 0 && (
          <button type="button" onClick={onLimpiar} className="flex items-center gap-1 px-2 py-1.5 text-sm text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 rounded">
            <X size={14} aria-hidden="true" /> Limpiar filtros ({activos})
          </button>
        )}
      </div>
    </div>
  );
}

export default ListaFiltros;
