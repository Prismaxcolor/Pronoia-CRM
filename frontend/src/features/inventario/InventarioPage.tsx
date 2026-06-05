import { useEffect, useState } from 'react';
import { ChevronRight, ChevronDown, Package } from 'lucide-react';
import {
  obtenerInventario,
  type GrupoInventario,
  type FiltrosInventario,
} from '../../services/inventario-service';
import { obtenerTiposMaterial } from '../../services/tipo-material-service';
import { obtenerProductos } from '../../services/producto-service';
import type { TipoMaterial, Producto } from '@shared/types/index.js';

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function InventarioPage() {
  const [grupos, setGrupos] = useState<GrupoInventario[]>([]);
  const [categorias, setCategorias] = useState<TipoMaterial[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtros, setFiltros] = useState<FiltrosInventario>({});
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

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
          Stock por material: entradas (compras) − salidas (ventas) ± transformaciones.
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
      </div>

      {cargando ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
        </div>
      ) : grupos.length === 0 ? (
        <p className="text-center text-text-muted py-12">No hay materiales para mostrar.</p>
      ) : (
        <div className="space-y-2">
          {grupos.map(g => {
            const clave = g.tipoMaterialId ?? '__sin__';
            const abierto = expandidos.has(clave);
            return (
              <div key={clave} className="bg-surface rounded-xl border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggle(clave)}
                  className="w-full flex items-center gap-3 px-5 py-4 hover:bg-surface-alt transition-colors"
                >
                  {abierto ? <ChevronDown size={18} className="text-text-muted shrink-0" /> : <ChevronRight size={18} className="text-text-muted shrink-0" />}
                  <div className="w-9 h-9 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 shrink-0">
                    <Package size={16} />
                  </div>
                  <span className="font-semibold text-text-primary text-sm flex-1 text-left">{g.nombreCategoria}</span>
                  <span className="text-xs text-text-muted mr-2">{g.articulos.length} art.</span>
                  <span className={`text-base font-bold ${g.totalKg < 0 ? 'text-red-600' : 'text-text-primary'}`}>
                    {fmt(g.totalKg)} kg
                  </span>
                </button>

                {abierto && (
                  <table className="w-full text-sm border-t border-border">
                    <thead>
                      <tr className="text-left text-xs text-text-muted bg-surface-alt">
                        <th className="px-5 py-2 font-medium">Artículo</th>
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
                          <td className="px-4 py-2.5 text-right text-text-secondary">{fmt(a.entradas)}</td>
                          <td className="px-4 py-2.5 text-right text-text-secondary">{fmt(a.salidas)}</td>
                          <td className="px-4 py-2.5 text-right text-text-secondary">{fmt(a.transformaciones)}</td>
                          <td className={`px-5 py-2.5 text-right font-semibold ${a.stock < 0 ? 'text-red-600' : 'text-text-primary'}`}>
                            {fmt(a.stock)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default InventarioPage;
