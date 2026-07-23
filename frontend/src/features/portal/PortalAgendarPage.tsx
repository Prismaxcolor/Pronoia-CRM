import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import {
  obtenerDisponibilidad,
  listarMisCitas,
  agendarCita,
  type HorarioDisponibilidad,
  type CitaPortal,
  type EstadoCita,
} from '../../services/portal-agendar-service';
import PortalHeader from '../../components/PortalHeader';

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

const ESTADO_LABEL: Record<EstadoCita, { texto: string; clase: string }> = {
  pendiente: { texto: 'Pendiente', clase: 'bg-amber-100 text-amber-700' },
  confirmada: { texto: 'Confirmada', clase: 'bg-green-100 text-green-700' },
  reprogramada: { texto: 'Reprogramada', clase: 'bg-blue-100 text-blue-700' },
  cancelada: { texto: 'Cancelada', clase: 'bg-red-100 text-red-700' },
  completada: { texto: 'Completada', clase: 'bg-gray-100 text-gray-600' },
};

function PortalAgendarPage() {
  const [fecha, setFecha] = useState(hoyISO());
  const [horarios, setHorarios] = useState<HorarioDisponibilidad[]>([]);
  const [misCitas, setMisCitas] = useState<CitaPortal[]>([]);
  const [cargando, setCargando] = useState(true);
  const [agendando, setAgendando] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  const cargarDisponibilidad = (f: string) => {
    obtenerDisponibilidad(f).then(setHorarios);
  };

  useEffect(() => {
    Promise.all([listarMisCitas(), obtenerDisponibilidad(fecha)])
      .then(([citas, horarios]) => { setMisCitas(citas); setHorarios(horarios); })
      .finally(() => setCargando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFecha = (f: string) => {
    setFecha(f);
    setMensaje(null);
    cargarDisponibilidad(f);
  };

  const handleAgendar = async (hora: string) => {
    setAgendando(hora);
    setMensaje(null);
    const resultado = await agendarCita(fecha, hora);
    setAgendando(null);
    if ('error' in resultado) {
      setMensaje({ tipo: 'error', texto: resultado.error });
      return;
    }
    setMensaje({ tipo: 'ok', texto: `Cita agendada para el ${fecha} a las ${hora}.` });
    cargarDisponibilidad(fecha);
    listarMisCitas().then(setMisCitas);
  };

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-alt">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
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
                disabled={!h.disponible || agendando !== null}
                onClick={() => handleAgendar(h.hora)}
                className={`py-2 rounded-lg text-sm font-medium border transition-colors ${
                  h.disponible
                    ? 'border-brand-300 text-brand-700 hover:bg-brand-50'
                    : 'border-border text-text-muted opacity-40 cursor-not-allowed'
                } ${agendando === h.hora ? 'opacity-60' : ''}`}
              >
                {h.hora}
              </button>
            ))}
          </div>

          {mensaje && (
            <p className={`text-sm mt-4 ${mensaje.tipo === 'ok' ? 'text-green-700' : 'text-red-600'}`}>
              {mensaje.texto}
            </p>
          )}
        </section>

        <section>
          <h2 className="text-sm font-semibold text-text-secondary mb-2">Tus citas</h2>
          <div className="bg-surface rounded-2xl shadow-sm divide-y divide-border">
            {misCitas.length ? (
              misCitas.map(c => (
                <div key={c.id} className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-2">
                    <Clock size={16} className="text-text-muted" />
                    <div>
                      <p className="text-sm font-medium text-text-primary">{c.fecha}</p>
                      <p className="text-xs text-text-muted">{c.hora}</p>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ESTADO_LABEL[c.estado].clase}`}>
                    {ESTADO_LABEL[c.estado].texto}
                  </span>
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
