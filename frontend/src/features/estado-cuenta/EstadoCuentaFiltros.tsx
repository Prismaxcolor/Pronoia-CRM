import { X } from 'lucide-react';
import { Chip } from '../../components/ui';
import { hoyLocal, rangoDeAtajo } from '../../lib/rango-fechas';
import { TIPOS_ENTRADA } from '../../lib/terceros-kpis';
import { LABEL_POR_TIPO } from './estado-cuenta-comun';

export interface FiltrosEstadoCuenta {
  desde?: string;
  hasta?: string;
  tipo?: string;
}

interface Props {
  filtros: FiltrosEstadoCuenta;
  onCambiar: (cambios: Partial<Record<keyof FiltrosEstadoCuenta, string | undefined>>) => void;
  onLimpiar: () => void;
}

const campo = 'px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';
const etiquetaCampo = 'block text-xs font-medium text-text-secondary mb-1';

const ATAJOS = [
  { id: '30d', etiqueta: 'Últimos 30 días' },
  { id: 'mes', etiqueta: 'Este mes' },
] as const;

/** Filtros del estado de cuenta (periodo y tipo de movimiento). Desde y Hasta son independientes (como siempre):
 *  sin ninguno se ve todo el historial. Local porque FiltrosBarra exige las dos fechas a la vez y siempre marca un atajo. */
function EstadoCuentaFiltros({ filtros, onCambiar, onLimpiar }: Props) {
  const hoy = hoyLocal();
  const hayFiltros = Boolean(filtros.desde || filtros.hasta || filtros.tipo);
  const esAtajo = (id: (typeof ATAJOS)[number]['id']) => {
    const r = rangoDeAtajo(id, hoy);
    return filtros.desde === r.desde && filtros.hasta === r.hasta;
  };

  return (
    <div className="mb-6 rounded-xl border border-border bg-surface p-3 sm:p-4 print:hidden">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div>
          <label htmlFor="ec-desde" className={etiquetaCampo}>Desde</label>
          <input id="ec-desde" type="date" value={filtros.desde ?? ''} max={filtros.hasta} onChange={e => onCambiar({ desde: e.target.value || undefined })} className={campo} />
        </div>
        <div>
          <label htmlFor="ec-hasta" className={etiquetaCampo}>Hasta</label>
          <input id="ec-hasta" type="date" value={filtros.hasta ?? ''} min={filtros.desde} onChange={e => onCambiar({ hasta: e.target.value || undefined })} className={campo} />
        </div>
        <div className="min-w-[10rem]">
          <label htmlFor="ec-tipo" className={etiquetaCampo}>Tipo de movimiento</label>
          <select id="ec-tipo" value={filtros.tipo ?? ''} onChange={e => onCambiar({ tipo: e.target.value || undefined })} className={`${campo} w-full`}>
            <option value="">Todos</option>
            {TIPOS_ENTRADA.map(t => <option key={t} value={t}>{LABEL_POR_TIPO[t]}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2 pb-1" role="group" aria-label="Atajos de periodo">
          {ATAJOS.map(a => (
            <Chip key={a.id} seleccionado={esAtajo(a.id)} onClick={() => onCambiar(esAtajo(a.id) ? { desde: undefined, hasta: undefined } : rangoDeAtajo(a.id, hoy))}>{a.etiqueta}</Chip>
          ))}
          {hayFiltros && (
            <button type="button" onClick={onLimpiar} className="flex items-center gap-1 px-2 py-1 text-sm text-text-secondary hover:text-text-primary">
              <X size={14} aria-hidden="true" /> Limpiar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default EstadoCuentaFiltros;
