import { useEffect, useMemo, useState } from 'react';
import { Package, Lock, RefreshCw } from 'lucide-react';
import {
  obtenerInventario,
  type ArticuloInventario,
  type GrupoInventario,
  type FiltrosInventario,
} from '../../services/inventario-service';
import { obtenerTiposMaterial } from '../../services/tipo-material-service';
import { obtenerProductos } from '../../services/producto-service';
import { obtenerLotes } from '../../services/lote-service';
import { obtenerTomasFisicas } from '../../services/toma-fisica-service';
import { obtenerTransformaciones } from '../../services/transformacion-service';
import { usePestanaRecordada } from '../../hooks/use-pestana-recordada';
import Accordion from '../../components/Accordion';
import AlmacenesPanel from './AlmacenesPanel';
import TrasladosPanel from './TrasladosPanel';
import TomaFisicaPanel from './TomaFisicaPanel';
import type { TipoMaterial, Producto, Lote, ComposicionPCBItem, TomaFisicaInventario, Transformacion } from '@shared/types/index.js';

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface ArticuloConCategoria extends ArticuloInventario { categoria: string }
interface GrupoDestino {
  clave: string;
  label: string;
  totalKg: number;
  articulos: ArticuloConCategoria[];
  composicion?: ComposicionPCBItem[];
  stockLote?: number;
  /** Toma física abierta que bloquea este lote ahora mismo, si hay. */
  tomaFisicaBloqueando?: TomaFisicaInventario;
  /** Kg retirados de este lote por transformaciones PCB creadas pero
   *  todavía sin completar — "en limbo", ya salieron pero no llegaron
   *  a ningún destino todavía. */
  transformacionPendienteKg?: number;
}

/** ¿Esta toma física abierta bloquea este lote ahora mismo? Bloquea si es
 *  del mismo almacén, incluye alguna categoría "con lote" (PCB), y — si se
 *  acotó a lotes específicos al crearla — este lote es uno de ellos. */
function tomaFisicaBloqueaLote(lote: Lote, t: TomaFisicaInventario, categorias: TipoMaterial[]): boolean {
  if (t.estado !== 'abierta' || t.almacenId !== lote.almacenId) return false;
  const tieneCategoriaConLote = t.categoriaIds.some(id => categorias.find(c => c.id === id)?.sinLote === false);
  if (!tieneCategoriaConLote) return false;
  return t.loteIds.length === 0 || t.loteIds.includes(lote.id);
}

/** Regrupa los mismos artículos ya cargados por destino (MPP, lote o "sin
 *  movimiento") en vez de por categoría. Además incluye los lotes activos
 *  que todavía no tienen ningún producto pesado adentro, como grupo vacío —
 *  si no, un lote recién creado desaparece de esta vista hasta su primer pesaje. */
function agruparPorDestino(
  grupos: GrupoInventario[],
  lotes: Lote[],
  tomasFisicas: TomaFisicaInventario[],
  transformaciones: Transformacion[],
  categorias: TipoMaterial[]
): GrupoDestino[] {
  const mapa = new Map<string, GrupoDestino>();
  for (const g of grupos) {
    for (const a of g.articulos) {
      const clave = a.loteId ?? a.destinoTipo;
      if (!mapa.has(clave)) {
        mapa.set(clave, { clave, label: a.destinoLabel, totalKg: 0, articulos: [] });
      }
      const grupo = mapa.get(clave)!;
      grupo.articulos.push({ ...a, categoria: g.nombreCategoria });
      grupo.totalKg += a.stock;
    }
  }
  for (const l of lotes) {
    if (l.activo && !mapa.has(l.id)) {
      mapa.set(l.id, { clave: l.id, label: l.nombre, totalKg: 0, articulos: [] });
    }
  }
  // Adjunta composición, stock real, y estado de bloqueo/transformación
  // pendiente a cada grupo que corresponda a un lote real — los grupos
  // MPP/sin-lote no tienen lote asociado.
  for (const grupo of mapa.values()) {
    const lote = lotes.find(l => l.id === grupo.clave);
    if (!lote) continue;
    grupo.composicion = lote.composicion;
    grupo.stockLote = lote.stockKg;
    grupo.tomaFisicaBloqueando = tomasFisicas.find(t => tomaFisicaBloqueaLote(lote, t, categorias));
    const pendientesDeEsteLote = transformaciones.filter(
      t => t.categoria === 'pcb' && t.estado === 'bruto' && t.loteOrigenId === lote.id
    );
    if (pendientesDeEsteLote.length > 0) {
      grupo.transformacionPendienteKg = pendientesDeEsteLote.reduce((acc, t) => acc + t.pesoNeto, 0);
    }
  }
  return Array.from(mapa.values()).sort((a, b) => a.label.localeCompare(b.label));
}

type Agrupacion = 'categoria' | 'lote';
type Pestana = 'inventario' | 'almacenes' | 'traslados' | 'toma-fisica';

function InventarioPage() {
  const [pestana, setPestana] = usePestanaRecordada<Pestana>(
    'pronoia:inventario:pestana',
    ['inventario', 'almacenes', 'traslados', 'toma-fisica'],
    'inventario',
  );
  const [grupos, setGrupos] = useState<GrupoInventario[]>([]);
  const [categorias, setCategorias] = useState<TipoMaterial[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [tomasFisicas, setTomasFisicas] = useState<TomaFisicaInventario[]>([]);
  const [transformaciones, setTransformaciones] = useState<Transformacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtros, setFiltros] = useState<FiltrosInventario>({});
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [agrupacion, setAgrupacion] = useState<Agrupacion>('categoria');

  const gruposPorDestino = useMemo(
    () => agruparPorDestino(grupos, lotes, tomasFisicas, transformaciones, categorias),
    [grupos, lotes, tomasFisicas, transformaciones, categorias]
  );

  useEffect(() => {
    obtenerTiposMaterial().then(setCategorias);
    obtenerProductos().then(setProductos);
    obtenerLotes().then(setLotes);
    obtenerTomasFisicas().then(lista => setTomasFisicas(lista.filter(t => t.estado === 'abierta')));
    obtenerTransformaciones({ estado: 'bruto', categoria: 'pcb' }).then(setTransformaciones);
  }, []);

  useEffect(() => {
    obtenerInventario(filtros).then(setGrupos).finally(() => setCargando(false));
  }, [filtros]);

  const setFiltro = (campo: keyof FiltrosInventario, valor: string) =>
    setFiltros(prev => ({ ...prev, [campo]: valor || undefined }));

  const toggle = (clave: string) =>
    setExpandidos(prev => {
      const n = new Set(prev);
      if (n.has(clave)) n.delete(clave); else n.add(clave);
      return n;
    });

  const inputClass = "px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Inventario</h1>
        <p className="text-sm text-text-secondary mt-1">
          Stock por material y destino (MPP / lote): entradas (pesaje compra) − salidas (pesaje venta) ± transformaciones.
        </p>
      </div>

      <div className="flex flex-wrap rounded-lg overflow-hidden border border-border text-sm w-fit mb-6">
        <button type="button" onClick={() => setPestana('inventario')} className={`px-4 py-1.5 ${pestana === 'inventario' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
          Inventario
        </button>
        <button type="button" onClick={() => setPestana('almacenes')} className={`px-4 py-1.5 ${pestana === 'almacenes' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
          Almacenes
        </button>
        <button type="button" onClick={() => setPestana('traslados')} className={`px-4 py-1.5 ${pestana === 'traslados' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
          Traslados
        </button>
        <button type="button" onClick={() => setPestana('toma-fisica')} className={`px-4 py-1.5 ${pestana === 'toma-fisica' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
          Toma física
        </button>
      </div>

      {pestana === 'almacenes' && <AlmacenesPanel />}
      {pestana === 'traslados' && <TrasladosPanel />}
      {pestana === 'toma-fisica' && <TomaFisicaPanel />}

      {pestana === 'inventario' && (
      <>
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Categoría</label>
          <select value={filtros.tipoMaterialId ?? ''} onChange={e => setFiltro('tipoMaterialId', e.target.value)} className={`${inputClass} w-44`}>
            <option value="">Todas</option>
            {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Artículo</label>
          <select value={filtros.productoId ?? ''} onChange={e => setFiltro('productoId', e.target.value)} className={`${inputClass} w-44`}>
            <option value="">Todos</option>
            {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Desde</label>
          <input type="date" value={filtros.desde ?? ''} onChange={e => setFiltro('desde', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Hasta</label>
          <input type="date" value={filtros.hasta ?? ''} onChange={e => setFiltro('hasta', e.target.value)} className={inputClass} />
        </div>
        {(filtros.tipoMaterialId || filtros.productoId || filtros.desde || filtros.hasta) && (
          <button type="button" onClick={() => setFiltros({})} className="text-xs text-text-muted hover:text-text-primary underline pb-2">
            Limpiar
          </button>
        )}
        <div className="w-full sm:w-auto sm:ml-auto">
          <label className="block text-xs font-medium text-text-secondary mb-1">Agrupar por</label>
          <div className="flex rounded-lg overflow-hidden border border-border text-sm w-fit">
            <button type="button" onClick={() => setAgrupacion('categoria')} className={`px-3 py-2 ${agrupacion === 'categoria' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
              Categoría
            </button>
            <button type="button" onClick={() => setAgrupacion('lote')} className={`px-3 py-2 ${agrupacion === 'lote' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
              Lote
            </button>
          </div>
        </div>
      </div>

      {cargando ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
        </div>
      ) : grupos.length === 0 ? (
        <p className="text-center text-text-muted py-12">No hay materiales para mostrar.</p>
      ) : agrupacion === 'categoria' ? (
        <div className="space-y-2">
          {grupos.map(g => {
            const clave = g.tipoMaterialId ?? '__sin__';
            return (
              <Accordion
                key={clave}
                open={expandidos.has(clave)}
                onToggle={() => toggle(clave)}
                header={
                  <>
                    <div className="w-9 h-9 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 shrink-0">
                      <Package size={16} />
                    </div>
                    <span className="font-semibold text-text-primary text-sm flex-1 text-left">{g.nombreCategoria}</span>
                    <span className="text-xs text-text-muted mr-2">{g.articulos.length} art.</span>
                    <span className={`text-base font-bold ${g.totalKg < 0 ? 'text-red-600' : 'text-text-primary'}`}>
                      {fmt(g.totalKg)} kg
                    </span>
                  </>
                }
              >
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-text-muted bg-surface-alt">
                      <th className="px-5 py-2 font-medium">Artículo</th>
                      <th className="px-4 py-2 font-medium">Destino</th>
                      <th className="px-4 py-2 font-medium text-right">Entradas</th>
                      <th className="px-4 py-2 font-medium text-right">Salidas</th>
                      <th className="px-4 py-2 font-medium text-right">Transf.</th>
                      <th className="px-5 py-2 font-medium text-right">Stock (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.articulos.map(a => (
                      <tr key={`${a.productoId}-${a.loteId ?? 'mpp'}`} className="border-t border-border">
                        <td className="px-5 py-2.5 text-text-primary">{a.nombre}</td>
                        <td className="px-4 py-2.5">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${a.destinoTipo === 'lote' ? 'bg-brand-100 text-brand-700' : 'bg-surface-alt text-text-secondary'}`}>
                            {a.destinoLabel}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-text-secondary">{fmt(a.entradas)}</td>
                        <td className="px-4 py-2.5 text-right text-text-secondary">{fmt(a.salidas)}</td>
                        <td className="px-4 py-2.5 text-right text-text-secondary">{fmt(a.transformaciones)}</td>
                        <td className={`px-5 py-2.5 text-right font-semibold ${a.stock < 0 ? 'text-red-600' : 'text-text-primary'}`}>
                          {fmt(a.stock)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </Accordion>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {gruposPorDestino.map(g => (
            <Accordion
              key={g.clave}
              open={expandidos.has(g.clave)}
              onToggle={() => toggle(g.clave)}
              header={
                <>
                  <div className="w-9 h-9 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 shrink-0">
                    <Package size={16} />
                  </div>
                  <span className="font-semibold text-text-primary text-sm flex-1 text-left truncate">{g.label}</span>
                  {g.tomaFisicaBloqueando && (
                    <span
                      className="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700 shrink-0"
                      title={`Bloqueado por la toma física ${g.tomaFisicaBloqueando.codigo}, abierta`}
                    >
                      <Lock size={11} /> Toma física {g.tomaFisicaBloqueando.codigo}
                    </span>
                  )}
                  {g.transformacionPendienteKg != null && (
                    <span
                      className="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700 shrink-0"
                      title="Peso retirado por una transformación PCB creada pero todavía sin completar"
                    >
                      <RefreshCw size={11} /> En transformación: {fmt(g.transformacionPendienteKg)} kg
                    </span>
                  )}
                  <span className="text-xs text-text-muted mr-2">{g.articulos.length} art.</span>
                  <span className={`text-base font-bold ${g.totalKg < 0 ? 'text-red-600' : 'text-text-primary'}`}>
                    {fmt(g.totalKg)} kg
                  </span>
                </>
              }
            >
              {g.composicion && g.composicion.length > 0 && (
                <div className="px-5 pt-3 pb-1 bg-surface-alt border-b border-border">
                  <p className="text-[11px] font-medium text-text-secondary mb-1.5">Composición estimada</p>
                  <div className="flex flex-wrap gap-1 pb-2">
                    {g.composicion.map(c => (
                      <span key={c.item} className="text-[11px] bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
                        {c.item}: {c.porcentaje}% · ~{fmt((g.stockLote ?? g.totalKg) * (c.porcentaje / 100))} kg
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-text-muted bg-surface-alt">
                    <th className="px-5 py-2 font-medium">Artículo</th>
                    <th className="px-4 py-2 font-medium">Categoría</th>
                    <th className="px-4 py-2 font-medium text-right">Entradas</th>
                    <th className="px-4 py-2 font-medium text-right">Salidas</th>
                    <th className="px-4 py-2 font-medium text-right">Transf.</th>
                    <th className="px-5 py-2 font-medium text-right">Stock (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {g.articulos.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-3 text-text-muted text-xs">
                        Todavía no se pesó ningún artículo hacia este lote.
                      </td>
                    </tr>
                  ) : g.articulos.map(a => (
                    <tr key={a.productoId} className="border-t border-border">
                      <td className="px-5 py-2.5 text-text-primary">{a.nombre}</td>
                      <td className="px-4 py-2.5 text-text-secondary">{a.categoria}</td>
                      <td className="px-4 py-2.5 text-right text-text-secondary">{fmt(a.entradas)}</td>
                      <td className="px-4 py-2.5 text-right text-text-secondary">{fmt(a.salidas)}</td>
                      <td className="px-4 py-2.5 text-right text-text-secondary">{fmt(a.transformaciones)}</td>
                      <td className={`px-5 py-2.5 text-right font-semibold ${a.stock < 0 ? 'text-red-600' : 'text-text-primary'}`}>
                        {fmt(a.stock)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </Accordion>
          ))}
        </div>
      )}
      </>
      )}
    </div>
  );
}

export default InventarioPage;
