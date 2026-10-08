import { useEffect, useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { ATAJOS_RANGO, atajoActivo, hoyLocal, rangoDeAtajo, type AtajoRango } from '../../lib/rango-fechas';

/** CUÁNDO USARLA: barra de filtros arriba de una pantalla de listado o análisis. Regla: máximo 3 filtros visibles
 *  (periodo, un selector, buscador); el resto va en "Más filtros" (colapsable, con contador). El estado debe vivir en la URL
 *  (hook useFiltrosUrl) para que se pueda compartir y recargar. Cada pieza es opcional: pasa solo lo que la pantalla necesita. */

export interface OpcionFiltro { valor: string; etiqueta: string }

export interface SelectorFiltro {
  id: string;
  etiqueta: string;
  valor?: string;
  /** Sin opciones (undefined) y `cargando`, el selector se deshabilita y dice "Cargando…". */
  opciones?: ReadonlyArray<OpcionFiltro>;
  onCambiar: (valor: string | undefined) => void;
  /** Texto de la opción vacía (por defecto "Todos"). */
  textoTodas?: string;
  cargando?: boolean;
}

export interface RangoFiltro {
  desde?: string;
  hasta?: string;
  onCambiar: (rango: { desde?: string; hasta?: string }) => void;
  atajos?: ReadonlyArray<AtajoRango>;
  /** Atajo que equivale a "sin rango" (se limpia el rango al elegirlo). Por defecto '30d'. */
  atajoPorDefecto?: AtajoRango;
}

export interface BuscadorFiltro {
  id: string;
  valor?: string;
  onCambiar: (valor: string | undefined) => void;
  placeholder?: string;
  etiqueta?: string;
}

export interface FiltrosBarraProps {
  rango?: RangoFiltro;
  /** Selectores siempre visibles (idealmente uno). */
  selectores?: ReadonlyArray<SelectorFiltro>;
  buscador?: BuscadorFiltro;
  /** Selectores de "Más filtros". */
  avanzados?: ReadonlyArray<SelectorFiltro>;
  /** Se llama cuando el panel "Más filtros" está abierto (para cargar sus opciones perezosamente; debe ser idempotente). */
  onAbrirAvanzados?: () => void;
  onLimpiar: () => void;
  /** Fecha "hoy" (para pruebas y demos). */
  hoy?: Date;
}

const ETIQUETAS_ATAJO: Record<AtajoRango, string> = { '7d': '7 días', '30d': '30 días', mes: 'Este mes', todo: 'Todo' };
const RETARDO_BUSCADOR_MS = 350;

const campo = 'px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';
const etiquetaCampo = 'block text-xs font-medium text-text-secondary mb-1';

function Selector({ s }: { s: SelectorFiltro }) {
  const cargando = s.cargando ?? !s.opciones;
  return (
    <div>
      <label htmlFor={s.id} className={etiquetaCampo}>{s.etiqueta}</label>
      <select id={s.id} value={s.valor ?? ''} disabled={cargando} onChange={e => s.onCambiar(e.target.value || undefined)} className={`${campo} w-full`}>
        <option value="">{cargando ? 'Cargando…' : (s.textoTodas ?? 'Todos')}</option>
        {s.opciones?.map(o => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
      </select>
    </div>
  );
}

/** Buscador con retardo: no reescribe la URL en cada tecla, y sigue a la URL si cambia por fuera (atrás, "Limpiar"). */
function Buscador({ b }: { b: BuscadorFiltro }) {
  const [texto, setTexto] = useState(b.valor ?? '');
  const { onCambiar } = b;

  useEffect(() => {
    if ((b.valor ?? '') === texto.trim()) return;
    const t = setTimeout(() => onCambiar(texto.trim() || undefined), RETARDO_BUSCADOR_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo reaccionamos al texto escrito.
  }, [texto]);

  // Se ajusta durante el render (no en un efecto); si coincide con lo escrito no se toca el campo.
  const [valorPrevio, setValorPrevio] = useState(b.valor);
  if (valorPrevio !== b.valor) {
    setValorPrevio(b.valor);
    if ((b.valor ?? '') !== texto.trim()) setTexto(b.valor ?? '');
  }

  return (
    <div className="min-w-[12rem] basis-full flex-1 sm:basis-0">
      <label htmlFor={b.id} className={etiquetaCampo}>{b.etiqueta ?? 'Buscar'}</label>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" />
        <input id={b.id} type="search" value={texto} onChange={e => setTexto(e.target.value)} placeholder={b.placeholder} className={`${campo} w-full pl-9`} />
      </div>
    </div>
  );
}

function SelectorRango({ r, hoy }: { r: RangoFiltro; hoy: Date }) {
  const atajos = r.atajos ?? ATAJOS_RANGO;
  const porDefecto = r.atajoPorDefecto ?? '30d';
  const activo = atajoActivo(r, hoy);
  const base = r.desde && r.hasta ? { desde: r.desde, hasta: r.hasta } : rangoDeAtajo(porDefecto, hoy);

  const fijarFecha = (clave: 'desde' | 'hasta', valor: string) => {
    const desde = clave === 'desde' ? valor : base.desde;
    const hasta = clave === 'hasta' ? valor : base.hasta;
    if (!desde || !hasta || desde > hasta) return;
    r.onCambiar({ desde, hasta });
  };

  return (
    <div>
      <span className={etiquetaCampo}>Periodo</span>
      <div className="flex flex-wrap items-center gap-1.5">
        <div role="group" aria-label="Atajos de periodo" className="flex overflow-hidden rounded-lg border border-border text-sm">
          {atajos.map(a => (
            <button
              key={a}
              type="button"
              aria-pressed={activo === a}
              onClick={() => r.onCambiar(a === porDefecto ? { desde: undefined, hasta: undefined } : rangoDeAtajo(a, hoy))}
              className={`px-3 py-2 ${activo === a ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary hover:bg-brand-50'}`}
            >
              {ETIQUETAS_ATAJO[a]}
            </button>
          ))}
        </div>
        <input type="date" aria-label="Desde" value={base.desde} max={base.hasta} onChange={e => fijarFecha('desde', e.target.value)} className={campo} />
        <span className="text-text-muted text-sm" aria-hidden="true">–</span>
        <input type="date" aria-label="Hasta" value={base.hasta} min={base.desde} onChange={e => fijarFecha('hasta', e.target.value)} className={campo} />
      </div>
    </div>
  );
}

function FiltrosBarra({ rango, selectores, buscador, avanzados, onAbrirAvanzados, onLimpiar, hoy }: FiltrosBarraProps) {
  const nAvanzados = (avanzados ?? []).filter(s => Boolean(s.valor)).length;
  const [masAbierto, setMasAbierto] = useState(nAvanzados > 0);
  const hayFiltros = Boolean(rango?.desde || (selectores ?? []).some(s => s.valor) || buscador?.valor || nAvanzados > 0);
  const hoyRef = hoy ?? hoyLocal();

  useEffect(() => { if (masAbierto) onAbrirAvanzados?.(); }, [masAbierto, onAbrirAvanzados]);

  return (
    <div className="mb-6 rounded-xl border border-border bg-surface p-3 sm:p-4">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        {rango && <SelectorRango r={rango} hoy={hoyRef} />}
        {selectores?.map(s => (
          <div key={s.id} className="min-w-[10rem] flex-1 sm:flex-none"><Selector s={s} /></div>
        ))}
        {buscador && <Buscador b={buscador} />}

        <div className="flex items-center gap-2">
          {avanzados && avanzados.length > 0 && (
            <button
              type="button"
              aria-expanded={masAbierto}
              onClick={() => setMasAbierto(v => !v)}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-secondary hover:bg-brand-50"
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
              Más filtros{nAvanzados > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-xs text-white">{nAvanzados}</span>}
            </button>
          )}
          {hayFiltros && (
            <button type="button" onClick={onLimpiar} className="flex items-center gap-1 px-2 py-2 text-sm text-text-secondary hover:text-text-primary">
              <X size={14} aria-hidden="true" /> Limpiar
            </button>
          )}
        </div>
      </div>

      {masAbierto && avanzados && avanzados.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-4">
          {avanzados.map(s => <Selector key={s.id} s={s} />)}
        </div>
      )}
    </div>
  );
}

export default FiltrosBarra;
