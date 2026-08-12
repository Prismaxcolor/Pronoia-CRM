import { useEffect, useState } from 'react';
import { Inbox } from 'lucide-react';
import {
  obtenerEstadoCuentaPortal,
  type EstadoCuentaPortal,
} from '../../services/portal-estado-cuenta-service';
import PortalHeader from '../../components/PortalHeader';
import PortalSkeleton from '../../components/PortalSkeleton';

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
      <div className="min-h-screen bg-surface-alt">
        <PortalHeader title="Estado de cuenta" backTo="/portal" />
        <PortalSkeleton filas={3} />
      </div>
    );
  }

  const saldo = datos?.totales.saldo ?? 0;
  const mensaje = mensajeSaldo(datos?.entidad.tipo ?? 'proveedor', saldo);

  return (
    <div className="min-h-screen bg-surface-alt">
      <PortalHeader title="Estado de cuenta" backTo="/portal" />

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <div className="bg-surface rounded-2xl shadow-sm p-6 text-center">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Saldo actual</p>
          <p className={`text-4xl font-bold mt-2 ${mensaje.positivo ? 'text-green-600' : 'text-red-600'}`}>
            ${fmt(Math.abs(saldo))}
          </p>
          <p className="text-sm text-text-muted mt-1">{mensaje.texto}</p>
          <div className="flex justify-center gap-6 mt-5 pt-5 border-t border-border text-sm">
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
          <div className="bg-surface rounded-2xl shadow-sm divide-y divide-border">
            {datos?.entradas.length ? (
              datos.entradas.map((e, i) => (
                <div key={i} className="flex items-center justify-between p-4">
                  <div>
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs mr-2 ${
                      e.tipo === 'factura' ? 'bg-amber-100 text-amber-700'
                        : e.tipo === 'adelanto' ? 'bg-teal-100 text-teal-700'
                        : 'bg-green-100 text-green-700'
                    }`}>
                      {e.tipo === 'factura' ? 'Factura' : e.tipo === 'adelanto' ? 'Adelanto' : 'Pago'}
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
              <div className="flex flex-col items-center gap-2 p-8 text-center">
                <Inbox size={22} className="text-text-muted" />
                <p className="text-sm text-text-muted">Todavía no tienes movimientos.</p>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default PortalEstadoCuentaPage;
