import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Contact, Truck } from 'lucide-react';
import type { EstadoCita } from '../../services/citas-service';
import { useAuth } from '../../hooks/use-auth-context';
import { Bloque, EstadoVacio, Insignia, SkeletonBloque, formatearFecha, type Tono } from '../../components/ui';
import { fechaLocalIso } from '../../lib/dashboard-kpis';
import { ErrorDeBloque } from './DashboardComun';
import { cargarProximosDespachos } from './dashboardFuentes';
import { useDashboardCarga } from './useDashboardCarga';

const TONO_ESTADO: Record<EstadoCita, Tono> = {
  pendiente: 'aviso',
  confirmada: 'exito',
  reprogramada: 'info',
  cancelada: 'neutral',
  completada: 'neutral',
};
const ETIQUETA_ESTADO: Record<EstadoCita, string> = {
  pendiente: 'Pendiente',
  confirmada: 'Confirmada',
  reprogramada: 'Reprogramada',
  cancelada: 'Cancelada',
  completada: 'Completada',
};

/** Bloque de solo lectura. Enlaza a /citas para cualquier acción (cambiar estados desde aquí duplicaría la pantalla de citas).
 *  Conserva su permiso: despachos:ver. */
function ProximosDespachos() {
  const { tienePermiso } = useAuth();
  const hoy = useMemo(() => fechaLocalIso(new Date()), []);
  const carga = useDashboardCarga({ permitido: tienePermiso('despachos', 'ver'), cargar: () => cargarProximosDespachos(hoy) });

  return (
    <Bloque
      titulo="Próximos despachos"
      queEstasViendo="las próximas 5 citas de entrega o retiro con proveedores y clientes, desde hoy en adelante y de la más cercana a la más lejana. No se muestran las canceladas ni las completadas."
      acciones={carga.estado === 'listo' || carga.estado === 'error'
        ? <Link to="/citas" className="text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Ver todas →</Link>
        : undefined}
    >
      {carga.estado === 'cargando' && <SkeletonBloque alto="h-40" etiqueta="Cargando despachos" />}
      {carga.estado === 'sinPermiso' && <EstadoVacio mensaje="Sin permiso para ver los despachos" />}
      {carga.estado === 'error' && <ErrorDeBloque mensaje={carga.mensaje} onReintentar={carga.recargar} />}
      {carga.estado === 'listo' && (carga.dato.length === 0
        ? (
          <EstadoVacio
            icono={<CalendarClock size={22} />}
            mensaje="No hay despachos agendados próximamente"
            descripcion="Aquí aparecen las citas que agenden los proveedores y clientes desde el portal, o que se creen en la pantalla de despachos."
            accion={{ etiqueta: 'Ir a despachos', to: '/citas' }}
          />
        )
        : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {carga.dato.map(c => (
              <li key={c.id}>
                <Link to="/citas" className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700" aria-hidden="true">
                    {c.entidadTipo === 'proveedor' ? <Truck size={15} /> : <Contact size={15} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-text-primary">{c.nombreEntidad}</span>
                    <span className="block text-xs tabular-nums text-text-secondary">
                      {c.fecha === hoy ? 'Hoy' : formatearFecha(c.fecha)} · {c.hora} · {c.entidadTipo === 'proveedor' ? 'proveedor' : 'cliente'}
                    </span>
                  </span>
                  <Insignia tono={TONO_ESTADO[c.estado]}>{ETIQUETA_ESTADO[c.estado]}</Insignia>
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </Bloque>
  );
}

export default ProximosDespachos;
