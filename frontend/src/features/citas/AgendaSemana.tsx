import { ChevronLeft, ChevronRight, Truck, Contact } from 'lucide-react';
import type { Cita, EstadoCita } from '../../services/citas-service';

const ESTADO_LABEL: Record<EstadoCita, { texto: string; clase: string }> = {
  pendiente: { texto: 'Pendiente', clase: 'bg-amber-100 text-amber-700 border-amber-200' },
  confirmada: { texto: 'Confirmada', clase: 'bg-green-100 text-green-700 border-green-200' },
  reprogramada: { texto: 'Reprog.', clase: 'bg-blue-100 text-blue-700 border-blue-200' },
  cancelada: { texto: 'Cancelada', clase: 'bg-red-100 text-red-700 border-red-200' },
  completada: { texto: 'Completada', clase: 'bg-gray-100 text-gray-600 border-gray-200' },
};

const DIA_LABEL = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

interface Props {
  /** Lunes de la semana mostrada (YYYY-MM-DD). */
  lunes: string;
  horarios: string[];
  citas: Cita[];
  onSemanaAnterior: () => void;
  onSemanaSiguiente: () => void;
  onVerCita: (cita: Cita) => void;
}

function AgendaSemana({ lunes, horarios, citas, onSemanaAnterior, onSemanaSiguiente, onVerCita }: Props) {
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
  const domingo = dias[6];

  const citaEn = (fecha: string, hora: string) =>
    citas.find(c => c.fecha === fecha && c.hora === hora && c.estado !== 'cancelada');

  const fmtDia = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    return `${d.getDate()}`;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={onSemanaAnterior}
          className="p-2 rounded-lg border border-border text-text-secondary hover:bg-surface-alt transition-colors"
          title="Semana anterior"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-medium text-text-primary">
          {lunes} — {domingo}
        </span>
        <button
          type="button"
          onClick={onSemanaSiguiente}
          className="p-2 rounded-lg border border-border text-text-secondary hover:bg-surface-alt transition-colors"
          title="Semana siguiente"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse min-w-[720px]">
            <thead>
              <tr className="border-b border-border">
                <th className="p-2 w-16 text-text-muted font-medium text-left">Hora</th>
                {dias.map((fecha, i) => (
                  <th key={fecha} className="p-2 text-center border-l border-border">
                    <div className="text-text-muted font-medium">{DIA_LABEL[i]}</div>
                    <div className="text-text-primary font-semibold">{fmtDia(fecha)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {horarios.map(hora => (
                <tr key={hora} className="border-b border-border last:border-b-0">
                  <td className="p-2 text-text-muted whitespace-nowrap">{hora}</td>
                  {dias.map(fecha => {
                    const cita = citaEn(fecha, hora);
                    return (
                      <td key={fecha} className="p-1.5 border-l border-border align-top">
                        {cita ? (
                          <button
                            type="button"
                            onClick={() => onVerCita(cita)}
                            className={`w-full flex items-center gap-1 px-1.5 py-1 rounded-md border text-left ${ESTADO_LABEL[cita.estado].clase}`}
                            title={`${cita.nombreEntidad} · ${ESTADO_LABEL[cita.estado].texto}`}
                          >
                            {cita.entidadTipo === 'proveedor' ? <Truck size={11} className="shrink-0" /> : <Contact size={11} className="shrink-0" />}
                            <span className="truncate">{cita.nombreEntidad}</span>
                          </button>
                        ) : (
                          <div className="h-6" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default AgendaSemana;
