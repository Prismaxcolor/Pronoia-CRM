import { ChevronLeft, ChevronRight, Truck, Contact } from 'lucide-react';
import type { Cita } from '../../services/citas-service';
import { INFO_ESTADO_CITA } from './estados-cita';
import { ESTILOS_TONO, formatearFecha } from '../../components/ui';
import EstadoVacio from '../../components/ui/EstadoVacio';
import { hoyNegocio } from '../../lib/fecha-negocio';


const DIA_LABEL = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const BOTON_SEMANA = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text-secondary transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';

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
  const hoy = hoyNegocio();

  const citaEn = (fecha: string, hora: string) =>
    citas.find(c => c.fecha === fecha && c.hora === hora && c.estado !== 'cancelada');

  const fmtDia = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return `${d.getDate()}`;
  };

  const haySemanaConCitas = citas.some(c => c.estado !== 'cancelada');

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <button type="button" onClick={onSemanaAnterior} className={BOTON_SEMANA} title="Semana anterior" aria-label="Semana anterior">
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <span className="text-sm font-medium text-text-primary tabular-nums" aria-live="polite">
          {formatearFecha(lunes)} — {formatearFecha(domingo)}
        </span>
        <button type="button" onClick={onSemanaSiguiente} className={BOTON_SEMANA} title="Semana siguiente" aria-label="Semana siguiente">
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>

      {horarios.length === 0 ? (
        <EstadoVacio
          mensaje="No hay horarios de atención configurados."
          descripcion="La agenda semanal se arma con los horarios disponibles; sin ellos no hay casillas que mostrar. Puedes seguir viendo las citas en la vista Lista."
        />
      ) : (
        <>
          {!haySemanaConCitas && (
            <p className="mb-2 text-xs text-text-secondary">No hay citas esta semana. Las casillas vacías son horarios libres.</p>
          )}
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-xs">
                <caption className="sr-only">Agenda semanal de citas</caption>
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="w-16 p-2 text-left font-medium text-text-secondary">Hora</th>
                    {dias.map((fecha, i) => (
                      <th key={fecha} scope="col" className={`border-l border-border p-2 text-center ${fecha === hoy ? 'bg-brand-50' : ''}`}>
                        <div className="font-medium text-text-secondary">{DIA_LABEL[i]}</div>
                        <div className={`font-semibold ${fecha === hoy ? 'text-brand-700' : 'text-text-primary'}`}>
                          {fmtDia(fecha)}{fecha === hoy && <span className="sr-only"> (hoy)</span>}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {horarios.map(hora => (
                    <tr key={hora} className="border-b border-border last:border-b-0">
                      <th scope="row" className="whitespace-nowrap p-2 text-left font-normal text-text-secondary tabular-nums">{hora}</th>
                      {dias.map(fecha => {
                        const cita = citaEn(fecha, hora);
                        const info = cita ? INFO_ESTADO_CITA[cita.estado] : null;
                        return (
                          <td key={fecha} className={`border-l border-border p-1.5 align-top ${fecha === hoy ? 'bg-brand-50/40' : ''}`}>
                            {cita && info ? (
                              <button
                                type="button"
                                onClick={() => onVerCita(cita)}
                                className={`flex w-full items-center gap-1 rounded-md border px-1.5 py-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${ESTILOS_TONO[info.tono].insignia} ${ESTILOS_TONO[info.tono].contenedor.split(' ')[0]}`}
                                title={`${cita.nombreEntidad} · ${info.texto}`}
                                aria-label={`${cita.nombreEntidad}, ${cita.hora}, ${info.texto}. Ver en la lista`}
                              >
                                {cita.entidadTipo === 'proveedor' ? <Truck size={11} className="shrink-0" aria-hidden="true" /> : <Contact size={11} className="shrink-0" aria-hidden="true" />}
                                <span className="truncate">{cita.nombreEntidad}</span>
                                <span className="ml-auto shrink-0 text-[10px] font-medium opacity-80">{info.textoCorto}</span>
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
        </>
      )}
    </div>
  );
}

export default AgendaSemana;
