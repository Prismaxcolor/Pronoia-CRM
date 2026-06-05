import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import {
  obtenerFacturas,
  type FacturaCV,
  type FiltrosFacturas,
  type TipoFactura,
} from '../../services/factura-cv-service';
import { obtenerProveedores } from '../../services/proveedor-service';
import { obtenerClientes } from '../../services/cliente-service';
import { obtenerProductos } from '../../services/producto-service';
import { useAuth } from '../../hooks/use-auth';
import type { Producto } from '@shared/types/index.js';

interface Entidad { id: string; nombre: string }

const ESTADO_CFG: Record<string, { label: string; clase: string }> = {
  borrador: { label: 'Borrador', clase: 'bg-gray-100 text-gray-600' },
  emitida: { label: 'Emitida', clase: 'bg-blue-100 text-blue-700' },
  pagada: { label: 'Pagada', clase: 'bg-green-100 text-green-700' },
};

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Props {
  tipo: TipoFactura;
}

function FacturaHistorialPage({ tipo }: Props) {
  const navigate = useNavigate();
  const { tienePermiso } = useAuth();
  const puedeCrear = tienePermiso('facturacion', 'crear');

  const esCompra = tipo === 'compra';
  const ruta = esCompra ? '/compras' : '/ventas';
  const titulo = esCompra ? 'Compras' : 'Ventas';
  const subtitulo = esCompra ? 'Facturas de compra a proveedores' : 'Facturas de venta a clientes';
  const labelEntidad = esCompra ? 'Proveedor' : 'Cliente';

  const [facturas, setFacturas] = useState<FacturaCV[]>([]);
  const [entidades, setEntidades] = useState<Entidad[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtros, setFiltros] = useState<FiltrosFacturas>({});

  useEffect(() => {
    const cargar = (): Promise<Entidad[]> => (esCompra ? obtenerProveedores() : obtenerClientes());
    cargar().then(setEntidades);
    obtenerProductos().then(setProductos);
  }, [esCompra]);

  useEffect(() => {
    setCargando(true);
    obtenerFacturas(tipo, filtros).then(setFacturas).finally(() => setCargando(false));
  }, [tipo, filtros]);

  const setFiltro = (campo: keyof FiltrosFacturas, valor: string) =>
    setFiltros(prev => ({ ...prev, [campo]: valor || undefined }));

  const inputClass = "px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{titulo}</h1>
          <p className="text-sm text-text-secondary mt-1">{subtitulo}</p>
        </div>
        {puedeCrear && (
          <button type="button" onClick={() => navigate(`${ruta}/nueva`)} className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors">
            <Plus size={18} />
            Nueva factura
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Desde</label>
          <input type="date" value={filtros.desde ?? ''} onChange={e => setFiltro('desde', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Hasta</label>
          <input type="date" value={filtros.hasta ?? ''} onChange={e => setFiltro('hasta', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">{labelEntidad}</label>
          <select value={filtros.entidadId ?? ''} onChange={e => setFiltro('entidadId', e.target.value)} className={`${inputClass} w-44`}>
            <option value="">Todos</option>
            {entidades.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Material</label>
          <select value={filtros.productoId ?? ''} onChange={e => setFiltro('productoId', e.target.value)} className={`${inputClass} w-44`}>
            <option value="">Todos</option>
            {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
        {(filtros.desde || filtros.hasta || filtros.entidadId || filtros.productoId) && (
          <button type="button" onClick={() => setFiltros({})} className="text-xs text-text-muted hover:text-text-primary underline pb-2">
            Limpiar
          </button>
        )}
      </div>

      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        {cargando ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
          </div>
        ) : facturas.length === 0 ? (
          <p className="text-center text-text-muted py-12 text-sm">No hay facturas con estos filtros.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted">
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3 font-medium">{labelEntidad}</th>
                <th className="px-4 py-3 font-medium">Material</th>
                <th className="px-4 py-3 font-medium text-right">Peso (kg)</th>
                <th className="px-4 py-3 font-medium text-right">Precio</th>
                <th className="px-4 py-3 font-medium text-right">Total</th>
                <th className="px-4 py-3 font-medium text-right">Estado</th>
              </tr>
            </thead>
            <tbody>
              {facturas.map(f => {
                const cfg = ESTADO_CFG[f.estado] ?? ESTADO_CFG.emitida;
                return (
                  <tr key={f.id} onClick={() => navigate(`${ruta}/${f.id}`)} className="border-b border-border last:border-b-0 hover:bg-surface-alt cursor-pointer transition-colors">
                    <td className="px-4 py-3 text-text-secondary whitespace-nowrap">{f.createdAt.slice(0, 10)}</td>
                    <td className="px-4 py-3 text-text-primary">{f.nombreEntidad ?? '—'}</td>
                    <td className="px-4 py-3 text-text-secondary">{f.nombreProducto ?? '—'}</td>
                    <td className="px-4 py-3 text-right">{fmt(f.peso)}</td>
                    <td className="px-4 py-3 text-right">{fmt(f.precioUnitario)}</td>
                    <td className="px-4 py-3 text-right font-medium text-text-primary">{fmt(f.total)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${cfg.clase}`}>{cfg.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default FacturaHistorialPage;
