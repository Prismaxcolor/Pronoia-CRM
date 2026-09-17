import { useEffect, useMemo, useState } from 'react';
import { Check, X, CheckCheck, Truck, Contact, Plus } from 'lucide-react';
import { listarCitas, actualizarEstadoCita, obtenerHorarios, type Cita, type EstadoCita } from '../../services/citas-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { usePestanaRecordada } from '../../hooks/use-pestana-recordada';
import AgendaSemana from './AgendaSemana';
import NuevaCitaModal from './NuevaCitaModal';

const ESTADO_LABEL: Record<EstadoCita, { texto: string; clase: string }> = {
  pendiente: { texto: 'Pendiente', clase: 'bg-amber-100 text-amber-700' },
  confirmada: { texto: 'Confirmada', clase: 'bg-green-100 text-green-700' },
  reprogramada: { texto: 'Reprogramada', clase: 'bg-blue-100 text-blue-700' },
  cancelada: { texto: 'Cancelada', clase: 'bg-red-100 text-red-700' },
  completada: { texto: 'Completada', clase: 'bg-gray-100 text-gray-600' },
};

type Vista = 'lista' | 'semana';

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana que contiene `iso` (semana empieza en lunes). */
function lunesDeSemana(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const diaSemana = (d.getDay() + 6) % 7; // 0 = lunes
  return sumarDias(iso, -diaSemana);
}

function CitasPage() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const puedeEditar = tienePermiso('despachos', 'editar');
  const puedeCrear = tienePermiso('despachos', 'crear');

  const [vista, setVista] = usePestanaRecordada<Vista>('pronoia:citas:vista', ['lista', 'semana'], 'lista');
  const [citas, setCitas] = useState<Cita[]>([]);
  const [cargando, setCargando] = useState(true);
  const [horarios, setHorarios] = useState<string[]>([]);
  const [verHistorico, setVerHistorico] = useState(false);
  const [lunes, setLunes] = useState(lunesDeSemana(hoyISO()));
  const [nuevaCitaAbierta, setNuevaCitaAbierta] = useState(false);

  const rangoActivo = vista === 'semana'
    ? { desde: lunes, hasta: sumarDias(lunes, 6) }
    : { desde: verHistorico ? undefined : hoyISO(), hasta: undefined };

  const recargar = () => listarCitas(rangoActivo.desde, rangoActivo.hasta).then(setCitas).finally(() => setCargando(false));
  const cargar = () => { setCargando(true); recargar(); };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { recargar(); }, [vista, verHistorico, lunes]);
  useEffect(() => { obtenerHorarios().then(setHorarios); }, []);

  const citasPorDia = useMemo(() => {
    const mapa = new Map<string, Cita[]>();
    for (const c of citas) {
      const lista = mapa.get(c.fecha) ?? [];
      lista.push(c);
      mapa.set(c.fecha, lista);
    }
    for (const lista of mapa.values()) lista.sort((a, b) => a.hora.localeCompare(b.hora));
    return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [citas]);

  const cambiarEstado = async (cita: Cita, estado: EstadoCita) => {
    try {
      await actualizarEstadoCita(cita.id, estado);
      toast.exito(`Cita de ${cita.nombreEntidad} actualizada.`);
      cargar();
    } catch (err) {
      toast.errorMsg(err instanceof Error ? err.message : 'No se pudo actualizar la cita.');
    }
  };

  const fmtFecha = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Despachos agendados</h1>
          <p className="text-sm text-text-secondary mt-1">
            Citas que proveedores y clientes agendaron desde el portal, o agendadas por el staff.
          </p>
        </div>
        {puedeCrear && (
          <button
            type="button"
            onClick={() => setNuevaCitaAbierta(true)}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors shrink-0"
          >
            <Plus size={18} />
            Agendar
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex rounded-lg overflow-hidden border border-border text-sm w-fit">
          <button type="button" onClick={() => setVista('lista')} className={`px-4 py-1.5 ${vista === 'lista' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
            Lista
          </button>
          <button type="button" onClick={() => setVista('semana')} className={`px-4 py-1.5 ${vista === 'semana' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
            Semana
          </button>
        </div>

        {vista === 'lista' && (
          <button
            type="button"
            onClick={() => setVerHistorico(v => !v)}
            className="text-xs text-text-muted hover:text-text-primary underline"
          >
            {verHistorico ? 'Ver solo próximas' : 'Ver histórico'}
          </button>
        )}
      </div>

      {cargando ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
        </div>
      ) : vista === 'semana' ? (
        <AgendaSemana
          lunes={lunes}
          horarios={horarios}
          citas={citas}
          onSemanaAnterior={() => setLunes(l => sumarDias(l, -7))}
          onSemanaSiguiente={() => setLunes(l => sumarDias(l, 7))}
          onVerCita={() => setVista('lista')}
        />
      ) : citas.length === 0 ? (
        <p className="text-center text-text-muted py-12 text-sm">No hay citas agendadas.</p>
      ) : (
        <div className="space-y-6">
          {citasPorDia.map(([fecha, citasDelDia]) => (
            <div key={fecha}>
              <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2 sticky top-0 bg-surface-alt py-1">
                {fmtFecha(fecha)}
              </h3>
              <div className="bg-surface rounded-xl border border-border overflow-hidden">
                {citasDelDia.map(c => (
                  <div key={c.id} className="flex items-center gap-4 px-5 py-3.5 border-b border-border last:border-b-0">
                    <div className="w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 shrink-0">
                      {c.entidadTipo === 'proveedor' ? <Truck size={16} /> : <Contact size={16} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">{c.nombreEntidad}</p>
                      <p className="text-xs text-text-muted">{c.hora}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${ESTADO_LABEL[c.estado].clase}`}>
                      {ESTADO_LABEL[c.estado].texto}
                    </span>
                    {puedeEditar && !['cancelada', 'completada'].includes(c.estado) && (
                      <div className="flex items-center gap-1 shrink-0">
                        {c.estado === 'pendiente' && (
                          <button
                            type="button"
                            onClick={() => cambiarEstado(c, 'confirmada')}
                            className="p-1.5 rounded-md hover:bg-surface-alt text-text-muted hover:text-green-600 transition-colors"
                            title="Confirmar"
                          >
                            <Check size={15} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => cambiarEstado(c, 'completada')}
                          className="p-1.5 rounded-md hover:bg-surface-alt text-text-muted hover:text-brand-600 transition-colors"
                          title="Marcar como completada"
                        >
                          <CheckCheck size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => cambiarEstado(c, 'cancelada')}
                          className="p-1.5 rounded-md hover:bg-surface-alt text-text-muted hover:text-red-600 transition-colors"
                          title="Cancelar"
                        >
                          <X size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {nuevaCitaAbierta && (
        <NuevaCitaModal onClose={() => setNuevaCitaAbierta(false)} onAgendada={cargar} />
      )}
    </div>
  );
}

export default CitasPage;
