import { useMemo } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Bloque, EstadoVacio, ListaAlertas, SkeletonBloque } from '../../components/ui';
import { HORAS_TICKET_BRUTO_ALERTA, construirAlertas, type ResumenTickets } from '../../lib/dashboard-kpis';
import { ErrorDeBloque } from './DashboardComun';
import type { MermaDashboard } from './dashboardFuentes';
import type { EstadoBloque } from './useDashboardCarga';

type Estado<T> = EstadoBloque<T> & { recargar: () => void };
type TomasAbiertas = Array<{ id: string; codigo: string; almacenNombre: string | null }>;

export interface DashboardAlertasProps {
  tickets: Estado<ResumenTickets>;
  tomas: Estado<TomasAbiertas>;
  merma: Estado<MermaDashboard>;
}

const datoDe = <T,>(e: Estado<T>): T | null => (e.estado === 'listo' ? e.dato : null);

/** Alertas operativas. Cada fuente se revisa solo si el usuario tiene su permiso; lo que no se pudo revisar se dice. */
function DashboardAlertas({ tickets, tomas, merma }: DashboardAlertasProps) {
  const fuentes = [
    { id: 'tickets', nombre: 'pesajes en bruto', e: tickets as Estado<unknown> },
    { id: 'tomas', nombre: 'tomas físicas abiertas', e: tomas as Estado<unknown> },
    { id: 'merma', nombre: 'merma', e: merma as Estado<unknown> },
  ];
  const alertas = useMemo(
    () => construirAlertas({ tickets: datoDe(tickets), tomasAbiertas: datoDe(tomas), merma: datoDe(merma) }),
    [tickets, tomas, merma],
  );

  const todasSinPermiso = fuentes.every(f => f.e.estado === 'sinPermiso');
  const cargando = fuentes.some(f => f.e.estado === 'cargando');
  const conError = fuentes.filter(f => f.e.estado === 'error');
  const sinPermiso = fuentes.filter(f => f.e.estado === 'sinPermiso');
  const revisadas = fuentes.filter(f => f.e.estado === 'listo');

  return (
    <Bloque
      titulo="Alertas"
      queEstasViendo={`lo que pide atención hoy: pesajes en bruto con más de ${HORAS_TICKET_BRUTO_ALERTA} h, tomas físicas abiertas y merma por encima del umbral.`}
    >
      {todasSinPermiso && <EstadoVacio mensaje="Sin permiso para ver las alertas" descripcion="Pídele a un administrador acceso a pesajes, inventario o toma física." />}
      {!todasSinPermiso && cargando && <SkeletonBloque alto="h-28" etiqueta="Cargando alertas" />}
      {!todasSinPermiso && !cargando && (
        <>
          {conError.map(f => (
            <div key={f.id} className="mb-3">
              <ErrorDeBloque mensaje={`No se pudo revisar: ${f.nombre}. ${f.e.estado === 'error' ? f.e.mensaje : ''}`} onReintentar={f.e.recargar} />
            </div>
          ))}
          <ListaAlertas
            alertas={alertas}
            vacio={revisadas.length === 0 ? <EstadoVacio mensaje="No se pudo revisar ninguna alerta ahora" /> : (
              <div className="flex gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4">
                <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-brand-600" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-brand-900">Todo en orden: no hay alertas ahora</p>
                  <p className="mt-1 text-xs text-text-secondary">Se revisó: {revisadas.map(f => f.nombre).join(', ')}.</p>
                </div>
              </div>
            )}
          />
          {sinPermiso.length > 0 && (
            <p className="mt-3 text-xs text-text-secondary">Sin permiso para revisar: {sinPermiso.map(f => f.nombre).join(', ')}.</p>
          )}
        </>
      )}
    </Bloque>
  );
}

export default DashboardAlertas;
