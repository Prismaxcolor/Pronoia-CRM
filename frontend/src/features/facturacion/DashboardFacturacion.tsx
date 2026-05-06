import { useEffect, useState } from 'react';
import { FilePlus, FileText, Trash2, ArrowRight, ShoppingCart } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/use-auth';
import { useToast } from '../../hooks/use-toast';
import { useConfirm } from '../../hooks/use-confirm';
import { obtenerBorradoresDelUsuario, crearBorrador, eliminarBorrador } from '../../services/factura-service';
import type { Factura } from '@shared/types/index.js';

function formatHaceCuanto(fecha: string): string {
  const ms = Date.now() - new Date(fecha).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'hace unos segundos';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} día${d > 1 ? 's' : ''}`;
}

function DashboardFacturacion() {
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const toast = useToast();
  const confirmar = useConfirm();
  const [borradores, setBorradores] = useState<Factura[]>([]);
  const [cargando, setCargando] = useState(true);
  const [creando, setCreando] = useState(false);
  const [borrando, setBorrando] = useState<string | null>(null);

  const cargar = async () => {
    if (!usuario) return;
    const data = await obtenerBorradoresDelUsuario(usuario.id);
    setBorradores(data);
  };

  useEffect(() => {
    cargar().finally(() => setCargando(false));
  }, [usuario?.id]);

  const handleNueva = async () => {
    if (!usuario || creando) return;
    setCreando(true);
    const nueva = await crearBorrador(usuario.id, 'USD');
    setCreando(false);
    if (nueva) {
      navigate(`/facturacion?factura=${nueva.id}`);
    } else {
      toast.errorMsg('No se pudo crear el borrador. Intenta de nuevo.');
    }
  };

  const handleContinuar = (facturaId: string) => {
    navigate(`/facturacion?factura=${facturaId}`);
  };

  const handleEliminar = async (factura: Factura) => {
    const cantidad = factura.items.length;
    const detalle = cantidad > 0 ? `Contiene ${cantidad} item${cantidad > 1 ? 's' : ''}.` : 'Está vacío.';
    const ok = await confirmar({
      titulo: `Eliminar borrador #${factura.numero}`,
      mensaje: `${detalle} Esta acción no se puede deshacer.`,
      confirmarLabel: 'Eliminar borrador',
      variante: 'danger',
    });
    if (!ok) return;

    setBorrando(factura.id);
    const okBorrar = await eliminarBorrador(factura.id);
    setBorrando(null);
    if (!okBorrar) {
      toast.errorMsg('No se pudo eliminar el borrador.');
      return;
    }
    toast.exito(`Borrador #${factura.numero} eliminado.`);
    setBorradores(prev => prev.filter(b => b.id !== factura.id));
  };

  if (cargando) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Facturación</h1>
        <p className="text-sm text-text-secondary mt-1">
          Genera facturas de compra para registrar adquisiciones de productos.
        </p>
      </div>

      {/* CTA gigante: nueva factura */}
      <button
        type="button"
        onClick={handleNueva}
        disabled={creando}
        className="w-full bg-gradient-to-br from-brand-600 to-brand-800 text-white rounded-2xl p-8 shadow-md hover:shadow-lg transition-all hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed group"
      >
        <div className="flex items-center justify-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center group-hover:bg-white/25 transition-colors">
            <FilePlus size={28} />
          </div>
          <div className="text-left">
            <p className="text-xl font-bold">{creando ? 'Creando borrador...' : 'Iniciar nueva factura'}</p>
            <p className="text-sm text-brand-100 mt-0.5">Crea un borrador y empieza a agregar productos</p>
          </div>
        </div>
      </button>

      {/* Borradores en curso */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
            Borradores en curso
          </h2>
          {borradores.length > 0 && (
            <span className="bg-brand-50 text-brand-700 text-xs px-2.5 py-1 rounded-full font-medium">
              {borradores.length} {borradores.length === 1 ? 'borrador' : 'borradores'}
            </span>
          )}
        </div>

        {borradores.length === 0 ? (
          <div className="bg-surface rounded-xl p-10 border-2 border-dashed border-border text-center">
            <FileText size={32} className="mx-auto text-text-muted mb-2 opacity-50" />
            <p className="text-text-muted text-sm">No tienes borradores guardados.</p>
            <p className="text-xs text-text-muted mt-1">Cuando inicies una factura nueva aparecerá aquí hasta que la confirmes.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {borradores.map(b => (
              <div
                key={b.id}
                className="bg-surface rounded-xl border border-border hover:border-brand-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-center gap-4 p-4">
                  <div className="w-10 h-10 rounded-lg bg-yellow-50 flex items-center justify-center flex-shrink-0">
                    <FileText size={20} className="text-yellow-600" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-text-primary">Factura #{b.numero}</span>
                      <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-medium">
                        borrador
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-text-muted">
                      <span className="inline-flex items-center gap-1">
                        <ShoppingCart size={12} />
                        {b.items.length} item{b.items.length !== 1 ? 's' : ''}
                      </span>
                      <span>·</span>
                      <span>{formatHaceCuanto(b.creadoEn)}</span>
                    </div>
                  </div>

                  <div className="text-right hidden sm:block">
                    <p className="text-lg font-bold text-text-primary">
                      {b.moneda === 'USD' ? '$' : 'Bs '}{b.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-text-muted">parcial</p>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleContinuar(b.id)}
                      className="inline-flex items-center gap-1 px-3 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
                    >
                      Continuar
                      <ArrowRight size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEliminar(b)}
                      disabled={borrando === b.id}
                      className="p-2 text-text-muted hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                      title="Eliminar borrador"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default DashboardFacturacion;
