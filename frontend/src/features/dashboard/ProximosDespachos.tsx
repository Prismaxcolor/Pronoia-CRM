import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, Truck, Contact } from 'lucide-react';
import { listarCitas, type Cita, type EstadoCita } from '../../services/citas-service';

const ESTADO_CLASE: Record<EstadoCita, string> = {
  pendiente: 'bg-amber-100 text-amber-700',
  confirmada: 'bg-green-100 text-green-700',
  reprogramada: 'bg-blue-100 text-blue-700',
  cancelada: 'bg-red-100 text-red-700',
  completada: 'bg-gray-100 text-gray-600',
};

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Widget de solo lectura: próximas 5 citas desde hoy. Enlaza a /citas para
 *  cualquier acción — duplicar los botones de estado acá multiplicaría el
 *  código de mantenimiento sin ganancia real. */
function ProximosDespachos() {
  const navigate = useNavigate();
  const [citas, setCitas] = useState<Cita[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    listarCitas(hoyISO())
      .then(lista => setCitas(lista.filter(c => c.estado !== 'cancelada' && c.estado !== 'completada').slice(0, 5)))
      .finally(() => setCargando(false));
  }, []);

  if (cargando) return null;

  return (
    <div className="bg-surface rounded-xl p-5 shadow-sm border border-border">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-text-primary flex items-center gap-2">
          <CalendarClock size={16} className="text-brand-600" />
          Próximos despachos
        </h3>
        <button type="button" onClick={() => navigate('/citas')} className="text-xs text-brand-600 hover:underline">
          Ver todos
        </button>
      </div>

      {citas.length === 0 ? (
        <p className="text-sm text-text-muted py-4 text-center">No hay despachos agendados próximamente.</p>
      ) : (
        <div className="space-y-1">
          {citas.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => navigate('/citas')}
              className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface-alt transition-colors text-left"
            >
              <div className="w-7 h-7 rounded-md bg-brand-100 flex items-center justify-center text-brand-700 shrink-0">
                {c.entidadTipo === 'proveedor' ? <Truck size={13} /> : <Contact size={13} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary truncate">{c.nombreEntidad}</p>
                <p className="text-xs text-text-muted">{c.fecha} · {c.hora}</p>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${ESTADO_CLASE[c.estado]}`}>
                {c.estado}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default ProximosDespachos;
