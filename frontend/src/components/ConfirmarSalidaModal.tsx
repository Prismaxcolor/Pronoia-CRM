import { useState } from 'react';
import { AlertTriangle, Download } from 'lucide-react';
import { nombreArchivoRespaldo, type PlanSalida } from '../lib/offline/salida-logica';

interface Props {
  plan: PlanSalida;
  onCancelar: () => void;
  /** `borrarBorradores`: borra los borradores de formularios de este equipo. La cola nunca se borra. */
  onSalir: (borrarBorradores: boolean) => Promise<void>;
  onExportar: () => Promise<Blob>;
}

function descargar(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Confirmación al cerrar sesión cuando hay pendientes sin enviar o borradores en el equipo. */
function ConfirmarSalidaModal({ plan, onCancelar, onSalir, onExportar }: Props) {
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const exportar = async () => {
    setOcupado(true);
    setAviso(null);
    try {
      descargar(await onExportar(), nombreArchivoRespaldo(new Date()));
      setAviso('Respaldo descargado. Guárdalo en un lugar seguro.');
    } catch (err) {
      setAviso(`No se pudo exportar el respaldo: ${err instanceof Error ? err.message : 'error desconocido'}.`);
    } finally {
      setOcupado(false);
    }
  };

  const salir = async (borrar: boolean) => {
    setOcupado(true);
    try {
      await onSalir(borrar);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="salida-titulo"
      className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/50"
      onClick={ocupado ? undefined : onCancelar}
    >
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-4 p-5">
          <div className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center bg-amber-50 text-amber-600">
            <AlertTriangle size={22} />
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <h2 id="salida-titulo" className="text-base font-bold text-text-primary leading-tight">{plan.titulo}</h2>
            <div className="mt-1.5 space-y-2">
              {plan.mensajes.map(m => (
                <p key={m} className="text-sm text-text-secondary leading-relaxed">{m}</p>
              ))}
            </div>
            {aviso && <p role="status" className="mt-3 text-xs text-text-secondary">{aviso}</p>}
          </div>
        </div>

        <div className="flex flex-col gap-2 px-5 py-4 bg-surface-alt border-t border-border">
          {plan.ofrecerExportar && (
            <button
              type="button"
              disabled={ocupado}
              onClick={exportar}
              className="flex items-center justify-center gap-2 py-2.5 border border-border rounded-lg text-sm font-medium text-text-primary hover:bg-surface-hover disabled:opacity-50"
            >
              <Download size={16} aria-hidden="true" />
              Exportar respaldo
            </button>
          )}
          <button
            type="button"
            disabled={ocupado}
            onClick={() => void salir(false)}
            className="py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {plan.ofrecerBorrarBorradores ? 'Salir y conservar mis datos' : 'Salir'}
          </button>
          {plan.ofrecerBorrarBorradores && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => void salir(true)}
              className="py-2.5 border border-red-300 text-red-700 hover:bg-red-50 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              Salir y borrar borradores de este equipo
            </button>
          )}
          <button
            type="button"
            disabled={ocupado}
            onClick={onCancelar}
            className="py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-hover rounded-lg disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmarSalidaModal;
