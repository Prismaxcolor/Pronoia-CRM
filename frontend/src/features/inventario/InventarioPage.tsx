import { useEffect, useMemo, useState } from 'react';
import { Package } from 'lucide-react';
import {
  obtenerInventario,
  type ArticuloInventario,
  type GrupoInventario,
  type FiltrosInventario,
} from '../../services/inventario-service';
import { obtenerTiposMaterial } from '../../services/tipo-material-service';
import { obtenerProductos } from '../../services/producto-service';
import Accordion from '../../components/Accordion';
import type { TipoMaterial, Producto } from '@shared/types/index.js';

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface ArticuloConCategoria extends ArticuloInventario { categoria: string }
interface GrupoDestino {
  clave: string;
  label: string;
  totalKg: number;
  articulos: ArticuloConCategoria[];
}

/** Regrupa los mismos artículos ya cargados por destino (MPP o lote) en vez de por categoría. */
function agruparPorDestino(grupos: GrupoInventario[]): GrupoDestino[] {
  const mapa = new Map<string, GrupoDestino>();
  for (const g of grupos) {
    for (const a of g.articulos) {
      const clave = a.loteId ?? 'mpp';
      if (!mapa.has(clave)) {
        mapa.set(clave, { clave, label: a.destinoLabel, totalKg: 0, articulos: [] });
      }
      const grupo = mapa.get(clave)!;
      grupo.articulos.push({ ...a, categoria: g.nombreCategoria });
      grupo.totalKg += a.stock;
    }
  }
  return Array.from(mapa.values()).sort((a, b) => a.label.localeCompare(b.label));
}

type Agrupacion = 'categoria' | 'lote';

function InventarioPage() {
  const [grupos, setGrupos] = useState<GrupoInventario[]>([]);
  const [categorias, setCategorias] = useState<TipoMaterial[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtros, setFiltros] = useState<FiltrosInventario>({});
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [agrupacion, setAgrupacion] = useState<Agrupacion>('categoria');

  const gruposPorDestino = useMemo(() => agruparPorDestino(grupos), [grupos]);

  useEffect(() => {
    obtenerTiposMaterial().then(setCategorias);
    obtenerProductos().then(setProductos);
  }, []);

  useEffect(() => {
    setCargando(true);
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
        <div className="ml-auto">
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
                  <span className="font-semibold text-text-primary text-sm flex-1 text-left">{g.label}</span>
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
                    <th className="px-4 py-2 font-medium">Categoría</th>
                    <th className="px-4 py-2 font-medium text-right">Entradas</th>
                    <th className="px-4 py-2 font-medium text-right">Salidas</th>
                    <th className="px-4 py-2 font-medium text-right">Transf.</th>
                    <th className="px-5 py-2 font-medium text-right">Stock (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {g.articulos.map(a => (
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
    </div>
  );
}

export default InventarioPage;
