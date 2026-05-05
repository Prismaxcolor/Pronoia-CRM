import { useEffect, useState } from 'react';
import { FileText, ChevronDown, ChevronUp, Calendar } from 'lucide-react';
import { obtenerFacturas, obtenerFacturasPorUsuario } from '../../services/factura-service';
import { useAuth } from '../../hooks/use-auth';
import type { Factura } from '@shared/types/index.js';

function HistorialFacturasPage() {
  const { usuario } = useAuth();
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [cargando, setCargando] = useState(true);
  const [expandida, setExpandida] = useState<string | null>(null);
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');

  const esSuperadmin = usuario?.rol === 'superadmin';

  useEffect(() => {
    if (!usuario) return;
    const cargar = esSuperadmin
      ? obtenerFacturas()
      : obtenerFacturasPorUsuario(usuario.id);

    cargar.then(setFacturas).finally(() => setCargando(false));
  }, [usuario, esSuperadmin]);

  const facturasFiltradas = facturas.filter(f => {
    if (fechaDesde) {
      const desde = new Date(fechaDesde);
      if (new Date(f.creadoEn) < desde) return false;
    }
    if (fechaHasta) {
      const hasta = new Date(fechaHasta);
      hasta.setHours(23, 59, 59);
      if (new Date(f.creadoEn) > hasta) return false;
    }
    return true;
  });

  const toggleExpand = (id: string) => {
    setExpandida(expandida === id ? null : id);
  };

  if (cargando) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Historial de Facturas</h1>
          <p className="text-sm text-text-secondary mt-1">
            {esSuperadmin ? 'Todas las facturas del sistema' : 'Tus facturas generadas'}
          </p>
        </div>
        <div className="flex items-center gap-2 bg-brand-50 text-brand-700 px-3 py-1.5 rounded-full text-xs font-medium">
          <FileText size={14} />
          {facturasFiltradas.length} factura{facturasFiltradas.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Filtros por fecha */}
      <div className="flex items-center gap-4 mb-6 p-4 bg-surface rounded-xl border border-border">
        <Calendar size={18} className="text-text-muted" />
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-secondary">Desde:</label>
          <input
            type="date"
            value={fechaDesde}
            onChange={e => setFechaDesde(e.target.value)}
            className="px-3 py-1.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-secondary">Hasta:</label>
          <input
            type="date"
            value={fechaHasta}
            onChange={e => setFechaHasta(e.target.value)}
            className="px-3 py-1.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        {(fechaDesde || fechaHasta) && (
          <button
            type="button"
            onClick={() => { setFechaDesde(''); setFechaHasta(''); }}
            className="text-xs text-brand-600 hover:text-brand-800 underline"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Lista de facturas */}
      {facturasFiltradas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <FileText size={48} className="text-text-muted/30 mb-3" />
          <p className="text-text-muted text-sm">No hay facturas en este rango</p>
        </div>
      ) : (
        <div className="space-y-3">
          {facturasFiltradas.map(f => (
            <div key={f.id} className="bg-surface rounded-xl border border-border overflow-hidden">
              {/* Header de factura */}
              <button
                type="button"
                onClick={() => toggleExpand(f.id)}
                className="w-full flex items-center gap-4 p-4 hover:bg-surface-hover transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center">
                  <FileText size={20} className="text-brand-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-text-primary">Factura #{f.numero}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      f.estado === 'confirmada' ? 'bg-green-100 text-green-700' :
                      f.estado === 'anulada' ? 'bg-red-100 text-red-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {f.estado}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-text-muted">
                      {new Date(f.creadoEn).toLocaleDateString()} a las {new Date(f.creadoEn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {esSuperadmin && f.nombreCreador && (
                      <span className="text-xs text-text-secondary">por <strong>{f.nombreCreador}</strong></span>
                    )}
                    <span className="text-xs text-text-muted">{f.items.length} item{f.items.length !== 1 ? 's' : ''}</span>
                  </div>
                </div>
                <span className="text-lg font-bold text-text-primary">${f.total.toLocaleString()}</span>
                {expandida === f.id ? <ChevronUp size={18} className="text-text-muted" /> : <ChevronDown size={18} className="text-text-muted" />}
              </button>

              {/* Detalle expandido */}
              {expandida === f.id && (
                <div className="border-t border-border px-4 pb-4">
                  <table className="w-full text-sm mt-3">
                    <thead>
                      <tr className="text-left">
                        <th className="pb-2 text-xs font-medium text-text-secondary">Producto</th>
                        <th className="pb-2 text-xs font-medium text-text-secondary text-center">Cantidad</th>
                        <th className="pb-2 text-xs font-medium text-text-secondary text-right">P. Unitario</th>
                        <th className="pb-2 text-xs font-medium text-text-secondary text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {f.items.map(item => (
                        <tr key={item.id} className="border-t border-border/50">
                          <td className="py-2 text-text-primary">{item.nombreProducto}</td>
                          <td className="py-2 text-text-secondary text-center">{item.cantidad}</td>
                          <td className="py-2 text-text-secondary text-right">${item.precioUnitario.toLocaleString()}</td>
                          <td className="py-2 text-text-primary text-right font-medium">${item.subtotal.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-border">
                        <td colSpan={3} className="pt-3 text-right text-sm font-medium text-text-secondary">Total:</td>
                        <td className="pt-3 text-right text-lg font-bold text-brand-600">${f.total.toLocaleString()}</td>
                      </tr>
                    </tfoot>
                  </table>
                  {f.nota && (
                    <div className="mt-3 p-2 bg-surface-alt rounded-lg">
                      <p className="text-xs text-text-secondary"><strong>Nota:</strong> {f.nota}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default HistorialFacturasPage;
