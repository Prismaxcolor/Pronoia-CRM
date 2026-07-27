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
import PortalHeader from '../../components/PortalHeader';
import PortalSkeleton from '../../components/PortalSkeleton';
import { useConfirm } from '../../hooks/use-confirm';
import { useToast } from '../../hooks/use-toast';

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fechaLegible(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long' });
}

const ESTADO_LABEL: Record<EstadoCita, { texto: string; clase: string }> = {
  pendiente: { texto: 'Pendiente', clase: 'bg-amber-100 text-amber-700' },
  confirmada: { texto: 'Confirmada', clase: 'bg-green-100 text-green-700' },
  reprogramada: { texto: 'Reprogramada', clase: 'bg-blue-100 text-blue-700' },
  cancelada: { texto: 'Cancelada', clase: 'bg-red-100 text-red-700' },
  completada: { texto: 'Completada', clase: 'bg-gray-100 text-gray-600' },
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

  if (cargando) {
    return (
      <div className="min-h-screen bg-surface-alt">
        <PortalHeader title="Agendar despacho" backTo="/portal" />
        <PortalSkeleton filas={2} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-alt">
      <PortalHeader title="Agendar despacho" backTo="/portal" />

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <section className="bg-surface rounded-2xl shadow-sm p-5">
          <label className="block text-xs font-medium text-text-secondary mb-2">Elige el día</label>
          <input
            type="date"
            value={fecha}
            min={hoyISO()}
            onChange={e => handleFecha(e.target.value)}
            className="w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
          />

          <p className="text-xs font-medium text-text-secondary mt-4 mb-2">Horarios disponibles</p>
          <div className="grid grid-cols-3 gap-2">
            {horarios.map(h => (
              <button
                key={h.hora}
                type="button"
                disabled={!h.disponible || procesando !== null}
                onClick={() => handleAgendar(h.hora)}
                className={`py-2 rounded-lg text-sm font-medium border transition-colors ${
                  h.disponible
                    ? 'border-brand-300 text-brand-700 hover:bg-brand-50'
                    : 'border-border text-text-muted opacity-40 cursor-not-allowed'
                } ${procesando === h.hora ? 'opacity-60' : ''}`}
              >
                {h.hora}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-text-secondary mb-2">Tus citas</h2>
          <div className="bg-surface rounded-2xl shadow-sm divide-y divide-border">
            {misCitas.length ? (
              misCitas.map(c => (
                <div key={c.id} className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <Clock size={16} className="text-text-muted shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-text-primary capitalize">{fechaLegible(c.fecha)}</p>
                      <p className="text-xs text-text-muted">{c.hora}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ESTADO_LABEL[c.estado].clase}`}>
                      {ESTADO_LABEL[c.estado].texto}
                    </span>
                    {CANCELABLES.includes(c.estado) && (
                      <button
                        type="button"
                        onClick={() => handleCancelar(c)}
                        disabled={procesando !== null}
                        className="p-1.5 rounded-md hover:bg-surface-alt text-text-muted hover:text-red-600 transition-colors disabled:opacity-50"
                        title="Cancelar"
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <p className="p-4 text-sm text-text-muted">Todavía no tienes citas agendadas.</p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default PortalAgendarPage;
