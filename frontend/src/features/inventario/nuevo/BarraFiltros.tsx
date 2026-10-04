import { useEffect, useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import {
  ETAPAS,
  atajoActivo,
  contarFiltrosAvanzados,
  rangoDeAtajo,
  type AtajoRango,
  type EtapaFiltro,
  type FiltrosPantalla,
} from '../../../lib/inventario-nuevo';
import { estiloCategoria } from '../../../lib/colores-categoria';
import { obtenerTiposMaterial } from '../../../services/tipo-material-service';
import { obtenerAlmacenes } from '../../../services/almacen-service';
import { obtenerProveedores } from '../../../services/proveedor-service';
import { obtenerLotes } from '../../../services/lote-service';

const ATAJOS: Array<{ id: AtajoRango; etiqueta: string }> = [
  { id: '7d', etiqueta: '7 días' },
  { id: '30d', etiqueta: '30 días' },
  { id: 'mes', etiqueta: 'Este mes' },
  { id: 'todo', etiqueta: 'Todo' },
];

const ETIQUETAS_ETAPA: Record<EtapaFiltro, string> = {
  materia_prima: 'Materia prima',
  en_proceso: 'En proceso',
  listo: 'Listo',
};

const RETARDO_BUSCADOR_MS = 350;

interface Opciones {
  almacenes: Array<{ id: string; nombre: string }>;
  proveedores: Array<{ id: string; nombre: string }>;
  lotes: Array<{ id: string; nombre: string }>;
}

/** "Hoy" según el reloj local, expresado como fecha UTC a medianoche (rangoDeAtajo trabaja en UTC). */
function hoyLocal(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

const campo = 'px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';
const etiquetaCampo = 'block text-xs font-medium text-text-secondary mb-1';

interface Props {
  filtros: FiltrosPantalla;
  onCambiar: (cambios: Partial<FiltrosPantalla>) => void;
  onLimpiar: () => void;
}

/** Barra de filtros: 3 visibles (fechas, categoría, buscador); el resto en "Más filtros". El estado vive en la URL. */
function BarraFiltros({ filtros, onCambiar, onLimpiar }: Props) {
  const [categorias, setCategorias] = useState<string[]>([]);
  const [opciones, setOpciones] = useState<Opciones | null>(null);
  const [masAbierto, setMasAbierto] = useState(contarFiltrosAvanzados(filtros) > 0);
  const [texto, setTexto] = useState(filtros.q ?? '');

  useEffect(() => { obtenerTiposMaterial().then(l => setCategorias(l.map(c => c.nombre))); }, []);

  // Las listas de "Más filtros" se piden recién cuando se abre el panel.
  useEffect(() => {
    if (!masAbierto || opciones) return;
    Promise.all([obtenerAlmacenes(), obtenerProveedores(), obtenerLotes()]).then(([a, p, l]) =>
      setOpciones({
        almacenes: a.map(x => ({ id: x.id, nombre: x.nombre })),
        proveedores: p.map(x => ({ id: x.id, nombre: x.nombre })),
        lotes: l.map(x => ({ id: x.id, nombre: x.nombre })),
      }),
    );
  }, [masAbierto, opciones]);

  // Buscador con retardo: no reescribe la URL en cada tecla.
  useEffect(() => {
    if ((filtros.q ?? '') === texto.trim()) return;
    const t = setTimeout(() => onCambiar({ q: texto.trim() || undefined }), RETARDO_BUSCADOR_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo reaccionamos al texto escrito.
  }, [texto]);

  // Si la URL cambia por fuera (atrás/adelante, "Limpiar"), el campo la sigue.
  // (Se ajusta durante el render, no en un efecto; si coincide con lo escrito no se toca el campo.)
  const [qPrevia, setQPrevia] = useState(filtros.q);
  if (qPrevia !== filtros.q) {
    setQPrevia(filtros.q);
    if ((filtros.q ?? '') !== texto.trim()) setTexto(filtros.q ?? '');
  }

  const hoy = hoyLocal();
  const activo = atajoActivo(filtros, hoy);
  const nAvanzados = contarFiltrosAvanzados(filtros);
  const hayFiltros = Boolean(filtros.desde || filtros.categoria || filtros.q || nAvanzados > 0);

  const fijarFecha = (clave: 'desde' | 'hasta', valor: string) => {
    const base = filtros.desde && filtros.hasta ? filtros : rangoDeAtajo('30d', hoy);
    const desde = clave === 'desde' ? valor : base.desde;
    const hasta = clave === 'hasta' ? valor : base.hasta;
    if (!desde || !hasta || desde > hasta) return;
    onCambiar({ desde, hasta });
  };
  const mostrarRango = filtros.desde && filtros.hasta ? { desde: filtros.desde, hasta: filtros.hasta } : rangoDeAtajo('30d', hoy);

  return (
    <div className="mb-6 rounded-xl border border-border bg-surface p-3 sm:p-4">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div>
          <span className={etiquetaCampo}>Periodo</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <div role="group" aria-label="Atajos de periodo" className="flex overflow-hidden rounded-lg border border-border text-sm">
              {ATAJOS.map(a => (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={activo === a.id}
                  onClick={() => onCambiar(a.id === '30d' ? { desde: undefined, hasta: undefined } : rangoDeAtajo(a.id, hoy))}
                  className={`px-3 py-2 ${activo === a.id ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary hover:bg-brand-50'}`}
                >
                  {a.etiqueta}
                </button>
              ))}
            </div>
            <input type="date" aria-label="Desde" value={mostrarRango.desde} max={mostrarRango.hasta} onChange={e => fijarFecha('desde', e.target.value)} className={campo} />
            <span className="text-text-muted text-sm" aria-hidden="true">–</span>
            <input type="date" aria-label="Hasta" value={mostrarRango.hasta} min={mostrarRango.desde} onChange={e => fijarFecha('hasta', e.target.value)} className={campo} />
          </div>
        </div>

        <div className="min-w-[10rem] flex-1 sm:flex-none">
          <label htmlFor="inv-categoria" className={etiquetaCampo}>Categoría</label>
          <select id="inv-categoria" value={filtros.categoria ?? ''} onChange={e => onCambiar({ categoria: e.target.value || undefined })} className={`${campo} w-full`}>
            <option value="">Todas</option>
            {categorias.map(c => <option key={c} value={c}>{estiloCategoria(c).simbolo} {c}</option>)}
          </select>
        </div>

        <div className="min-w-[12rem] basis-full flex-1 sm:basis-0">
          <label htmlFor="inv-buscar" className={etiquetaCampo}>Buscar</label>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" />
            <input id="inv-buscar" type="search" value={texto} onChange={e => setTexto(e.target.value)} placeholder="Material, lote o proveedor" className={`${campo} w-full pl-9`} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-expanded={masAbierto}
            onClick={() => setMasAbierto(v => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-secondary hover:bg-brand-50"
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            Más filtros{nAvanzados > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-xs text-white">{nAvanzados}</span>}
          </button>
          {hayFiltros && (
            <button type="button" onClick={onLimpiar} className="flex items-center gap-1 px-2 py-2 text-sm text-text-secondary hover:text-text-primary">
              <X size={14} aria-hidden="true" /> Limpiar
            </button>
          )}
        </div>
      </div>

      {masAbierto && (
        <div className="mt-3 grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <SelectFiltro id="inv-almacen" etiqueta="Almacén" valor={filtros.almacen} opciones={opciones?.almacenes} cargando={!opciones} onChange={v => onCambiar({ almacen: v })} />
          <SelectFiltro id="inv-proveedor" etiqueta="Proveedor" valor={filtros.proveedor} opciones={opciones?.proveedores} cargando={!opciones} onChange={v => onCambiar({ proveedor: v })} />
          <div>
            <label htmlFor="inv-etapa" className={etiquetaCampo}>Etapa</label>
            <select id="inv-etapa" value={filtros.etapa ?? ''} onChange={e => onCambiar({ etapa: (e.target.value || undefined) as EtapaFiltro | undefined })} className={`${campo} w-full`}>
              <option value="">Todas</option>
              {ETAPAS.map(e => <option key={e} value={e}>{ETIQUETAS_ETAPA[e]}</option>)}
            </select>
          </div>
          <SelectFiltro id="inv-lote" etiqueta="Lote" valor={filtros.lote} opciones={opciones?.lotes} cargando={!opciones} onChange={v => onCambiar({ lote: v })} />
        </div>
      )}
    </div>
  );
}

interface SelectFiltroProps {
  id: string;
  etiqueta: string;
  valor: string | undefined;
  opciones: Array<{ id: string; nombre: string }> | undefined;
  cargando: boolean;
  onChange: (valor: string | undefined) => void;
}

function SelectFiltro({ id, etiqueta, valor, opciones, cargando, onChange }: SelectFiltroProps) {
  return (
    <div>
      <label htmlFor={id} className={etiquetaCampo}>{etiqueta}</label>
      <select id={id} value={valor ?? ''} disabled={cargando} onChange={e => onChange(e.target.value || undefined)} className={`${campo} w-full`}>
        <option value="">{cargando ? 'Cargando…' : 'Todos'}</option>
        {opciones?.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
      </select>
    </div>
  );
}

export default BarraFiltros;
