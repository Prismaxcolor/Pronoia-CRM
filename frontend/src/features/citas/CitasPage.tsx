import { useEffect, useState } from 'react';
import { Check, X, CheckCheck, Truck, Contact } from 'lucide-react';
import { listarCitas, actualizarEstadoCita, type Cita, type EstadoCita } from '../../services/citas-service';
import { useAuth } from '../../hooks/use-auth';
import { useToast } from '../../hooks/use-toast';

const ESTADO_LABEL: Record<EstadoCita, { texto: string; clase: string }> = {
  pendiente: { texto: 'Pendiente', clase: 'bg-amber-100 text-amber-700' },
  confirmada: { texto: 'Confirmada', clase: 'bg-green-100 text-green-700' },
  reprogramada: { texto: 'Reprogramada', clase: 'bg-blue-100 text-blue-700' },
  cancelada: { texto: 'Cancelada', clase: 'bg-red-100 text-red-700' },
  completada: { texto: 'Completada', clase: 'bg-gray-100 text-gray-600' },
};

function CitasPage() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const puedeEditar = tienePermiso('despachos', 'editar');

  const [citas, setCitas] = useState<Cita[]>([]);
  const [cargando, setCargando] = useState(true);

  const cargar = () => {
    setCargando(true);
    listarCitas().then(setCitas).finally(() => setCargando(false));
  };

  useEffect(() => { cargar(); }, []);

  const cambiarEstado = async (cita: Cita, estado: EstadoCita) => {
    try {
      await actualizarEstadoCita(cita.id, estado);
      toast.exito(`Cita de ${cita.nombreEntidad} actualizada.`);
      cargar();
    } catch (err) {
      toast.errorMsg(err instanceof Error ? err.message : 'No se pudo actualizar la cita.');
    }
  };

  if (cargando) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Despachos agendados</h1>
        <p className="text-sm text-text-secondary mt-1">
          Citas que proveedores y clientes agendaron desde el portal.
        </p>
      </div>

      {citas.length === 0 ? (
        <p className="text-center text-text-muted py-12 text-sm">No hay citas agendadas.</p>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          {citas.map(c => (
            <div key={c.id} className="flex items-center gap-4 px-5 py-3.5 border-b border-border last:border-b-0">
              <div className="w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 shrink-0">
                {c.entidadTipo === 'proveedor' ? <Truck size={16} /> : <Contact size={16} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{c.nombreEntidad}</p>
                <p className="text-xs text-text-muted">{c.fecha} · {c.hora}</p>
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
      )}
    </div>
  );
}

export default CitasPage;
