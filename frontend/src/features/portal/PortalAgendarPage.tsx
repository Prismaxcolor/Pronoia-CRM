import { useEffect, useState } from 'react';
import { Clock, X } from 'lucide-react';
import {
  obtenerDisponibilidad,
  listarMisCitas,
  agendarCita,
  cancelarCita,
  type HorarioDisponibilidad,
  type CitaPortal,
  type EstadoCita,
} from '../../services/portal-agendar-service';
import { Bloque, EstadoVacio, Insignia, SkeletonBloque } from '../../components/ui';
import type { Tono } from '../../lib/paleta';
import PortalLayout from './PortalLayout';
import { useConfirm } from '../../hooks/use-confirm-context';
import { useToast } from '../../hooks/use-toast-context';

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fechaLegible(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long' });
}

const ESTADO_LABEL: Record<EstadoCita, { texto: string; tono: Tono }> = {
  pendiente: { texto: 'Pendiente', tono: 'aviso' },
  confirmada: { texto: 'Confirmada', tono: 'exito' },
  reprogramada: { texto: 'Reprogramada', tono: 'info' },
  cancelada: { texto: 'Cancelada', tono: 'neutral' },
  completada: { texto: 'Completada', tono: 'neutral' },
};

const CANCELABLES: EstadoCita[] = ['pendiente', 'confirmada'];

function PortalAgendarPage() {
  const confirmar = useConfirm();
  const toast = useToast();

  const [fecha, setFecha] = useState(hoyISO());
  const [horarios, setHorarios] = useState<HorarioDisponibilidad[]>([]);
  const [misCitas, setMisCitas] = useState<CitaPortal[]>([]);
  const [cargando, setCargando] = useState(true);
  const [procesando, setProcesando] = useState<string | null>(null);

  const cargarDisponibilidad = (f: string) => {
    obtenerDisponibilidad(f).then(setHorarios);
  };

  const cargarCitas = () => listarMisCitas().then(setMisCitas);

  useEffect(() => {
    Promise.all([listarMisCitas(), obtenerDisponibilidad(fecha)])
      .then(([citas, horarios]) => { setMisCitas(citas); setHorarios(horarios); })
      .finally(() => setCargando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFecha = (f: string) => {
    setFecha(f);
    cargarDisponibilidad(f);
  };

  const handleAgendar = async (hora: string) => {
    const ok = await confirmar({
      titulo: 'Agendar despacho',
      mensaje: `¿Confirmas tu despacho para el ${fechaLegible(fecha)} a las ${hora}?`,
      confirmarLabel: 'Agendar',
    });
    if (!ok) return;

    setProcesando(hora);
    const resultado = await agendarCita(fecha, hora);
    setProcesando(null);

    if ('error' in resultado) {
      toast.errorMsg(resultado.error);
      return;
    }
    toast.exito(`Despacho agendado para el ${fechaLegible(fecha)} a las ${hora}.`);
    cargarDisponibilidad(fecha);
    cargarCitas();
  };

  const handleCancelar = async (cita: CitaPortal) => {
    const ok = await confirmar({
      titulo: 'Cancelar despacho',
      mensaje: `¿Seguro que quieres cancelar el despacho del ${fechaLegible(cita.fecha)} a las ${cita.hora}?`,
      confirmarLabel: 'Sí, cancelar',
      cancelarLabel: 'No',
      variante: 'danger',
    });
    if (!ok) return;

    setProcesando(cita.id);
    const resultado = await cancelarCita(cita.id);
    setProcesando(null);

    if ('error' in resultado) {
      toast.errorMsg(resultado.error);
      return;
    }
    toast.exito('Despacho cancelado.');
    if (cita.fecha === fecha) cargarDisponibilidad(fecha);
    cargarCitas();
  };

  return (
    <PortalLayout titulo="Agendar despacho" subtitulo="Elige el día y la hora de tu próxima entrega y revisa tus citas.">
      {cargando ? (
        <SkeletonBloque alto="h-48" />
      ) : (
        <>
          <Bloque titulo="Elige el día y la hora" queEstasViendo="Los horarios libres del día elegido. Toca uno para pedir tu despacho; te pediremos confirmar antes de agendarlo.">
            <div className="rounded-xl border border-border bg-surface p-4">
              <label htmlFor="portal-agendar-fecha" className="mb-2 block text-xs font-medium text-text-secondary">Día del despacho</label>
              <input
                id="portal-agendar-fecha"
                type="date"
                value={fecha}
                min={hoyISO()}
                onChange={e => handleFecha(e.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 sm:w-auto"
              />

              <p className="mb-2 mt-4 text-xs font-medium text-text-secondary">Horarios disponibles</p>
              {horarios.length ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {horarios.map(h => (
                    <button
                      key={h.hora}
                      type="button"
                      disabled={!h.disponible || procesando !== null}
                      onClick={() => handleAgendar(h.hora)}
                      aria-label={h.disponible ? `Agendar a las ${h.hora}` : `${h.hora}, no disponible`}
                      className={`min-h-[44px] rounded-lg border text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                        h.disponible
                          ? 'border-brand-300 text-brand-700 hover:bg-brand-50'
                          : 'cursor-not-allowed border-border text-text-muted line-through opacity-50'
                      } ${procesando === h.hora ? 'opacity-60' : ''}`}
                    >
                      {h.hora}
                    </button>
                  ))}
                </div>
              ) : (
                <EstadoVacio mensaje="No hay horarios para este día." descripcion="Prueba con otra fecha." />
              )}
            </div>
          </Bloque>

          <Bloque titulo="Tus citas" queEstasViendo="Los despachos que has agendado y su estado. Puedes cancelar los pendientes o confirmados.">
            {misCitas.length ? (
              <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
                {misCitas.map(c => (
                  <li key={c.id} className="flex items-center justify-between gap-3 p-4">
                    <div className="flex items-center gap-3">
                      <Clock size={16} className="shrink-0 text-text-muted" aria-hidden="true" />
                      <div>
                        <p className="text-sm font-medium capitalize text-text-primary">{fechaLegible(c.fecha)}</p>
                        <p className="text-xs text-text-secondary">{c.hora}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Insignia tono={ESTADO_LABEL[c.estado].tono}>{ESTADO_LABEL[c.estado].texto}</Insignia>
                      {CANCELABLES.includes(c.estado) && (
                        <button
                          type="button"
                          onClick={() => handleCancelar(c)}
                          disabled={procesando !== null}
                          aria-label={`Cancelar el despacho del ${fechaLegible(c.fecha)} a las ${c.hora}`}
                          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-alt hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50"
                        >
                          <X size={16} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EstadoVacio mensaje="Todavía no tienes citas agendadas." descripcion="Elige un día y una hora arriba para pedir tu primer despacho." />
            )}
          </Bloque>
        </>
      )}
    </PortalLayout>
  );
}

export default PortalAgendarPage;
