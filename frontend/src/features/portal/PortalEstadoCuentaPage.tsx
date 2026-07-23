import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import {
  obtenerEstadoCuentaPortal,
  type EstadoCuentaPortal,
} from '../../services/portal-estado-cuenta-service';

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fecha(iso: string): string {
  return iso.slice(0, 10);
}

/** El signo de "saldo" (facturado - pagado) significa cosas opuestas según quién
 *  es el dueño de la sesión: un proveedor le vende A Pronoia (saldo > 0 = Pronoia
 *  le debe), un cliente le compra A Pronoia (saldo > 0 = el cliente debe). */
function mensajeSaldo(tipo: 'proveedor' | 'cliente', saldo: number): { texto: string; positivo: boolean } {
  if (saldo === 0) return { texto: 'Sin saldo pendiente', positivo: true };

  const pronoiaDebe = tipo === 'proveedor' ? saldo > 0 : saldo < 0;
  return pronoiaDebe
    ? { texto: 'Pronoia te debe', positivo: true }
    : { texto: 'Le debes a Pronoia', positivo: false };
}

function PortalEstadoCuentaPage() {
  const [datos, setDatos] = useState<EstadoCuentaPortal | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    obtenerEstadoCuentaPortal().then(setDatos).finally(() => setCargando(false));
  }, []);

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-alt">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  const saldo = datos?.totales.saldo ?? 0;
  const mensaje = mensajeSaldo(datos?.entidad.tipo ?? 'proveedor', saldo);

  return (
    <div className="min-h-screen bg-surface-alt">
      <header className="bg-surface border-b border-border px-4 py-4 flex items-center gap-3">
        <Link to="/portal" className="text-text-muted hover:text-text-primary transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-lg font-bold text-text-primary">Estado de cuenta</h1>
      </header>

      <main className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
        <div className="bg-surface rounded-xl border border-border p-5 text-center">
          <p className="text-xs text-text-muted uppercase tracking-wide">Saldo actual</p>
          <p className={`text-3xl font-bold mt-1 ${mensaje.positivo ? 'text-green-600' : 'text-red-600'}`}>
            ${fmt(Math.abs(saldo))}
          </p>
          <p className="text-xs text-text-muted mt-1">{mensaje.texto}</p>
          <div className="flex justify-center gap-6 mt-4 pt-4 border-t border-border text-sm">
            <div>
              <p className="text-text-muted">Facturado</p>
              <p className="font-semibold text-text-primary">${fmt(datos?.totales.facturado ?? 0)}</p>
            </div>
            <div>
              <p className="text-text-muted">Pagado</p>
              <p className="font-semibold text-text-primary">${fmt(datos?.totales.pagado ?? 0)}</p>
            </div>
          </div>
        </div>

        <section>
          <h2 className="text-sm font-semibold text-text-secondary mb-2">Movimientos</h2>
          <div className="bg-surface rounded-xl border border-border divide-y divide-border">
            {datos?.entradas.length ? (
              datos.entradas.map((e, i) => (
                <div key={i} className="flex items-center justify-between p-4">
                  <div>
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs mr-2 ${
                      e.tipo === 'factura' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                    }`}>
                      {e.tipo === 'factura' ? 'Factura' : 'Pago'}
                    </span>
                    <p className="text-sm font-medium text-text-primary mt-1">{e.descripcion}</p>
                    <p className="text-xs text-text-muted">{fecha(e.fecha)}</p>
                  </div>
                  <p className="text-sm font-semibold text-text-primary">
                    ${fmt(e.tipo === 'factura' ? e.cargo : e.abono)}
                  </p>
                </div>
              ))
            ) : (
              <p className="p-4 text-sm text-text-muted">Todavía no tienes movimientos.</p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default PortalEstadoCuentaPage;
