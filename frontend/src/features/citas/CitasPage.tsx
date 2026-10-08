import { useEffect, useMemo, useState } from 'react';
import { Check, X, CheckCheck, Truck, Contact, Plus } from 'lucide-react';
import { listarCitas, actualizarEstadoCita, obtenerHorarios, type Cita, type EstadoCita } from '../../services/citas-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { usePestanaRecordada } from '../../hooks/use-pestana-recordada';
import AgendaSemana from './AgendaSemana';
import { INFO_ESTADO_CITA } from './estados-cita';
import NuevaCitaModal from './NuevaCitaModal';
import {
  EncabezadoPagina, Bloque, BotonAccion, GrillaKpis, TarjetaKpi, ControlSegmentado, FiltrosBarra, EstadoVacio,
  SkeletonKpis, SkeletonBloque, Insignia, Chip, useFiltrosUrl, formatearNumero,
} from '../../components/ui';
import { kpisCitas } from '../../lib/catalogos-kpis';
import { hoyNegocio } from '../../lib/fecha-negocio';
import { LECTURAS } from '../../lib/offline/prefijos-lectura';

type Vista = 'lista' | 'semana';

const ESTADOS_CITA: readonly EstadoCita[] = ['pendiente', 'confirmada', 'reprogramada', 'cancelada', 'completada'];
const ESQUEMA_FILTROS = { campos: { estado: { tipo: 'opcion', opciones: ESTADOS_CITA } } } as const;
const OPCIONES_ESTADO = ESTADOS_CITA.map(e => ({ valor: e, etiqueta: INFO_ESTADO_CITA[e].texto }));
const BOTON_ICONO = 'inline-flex h-9 w-9 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';

function hoyISO(): string {
  return hoyNegocio();
}

function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana que contiene `iso` (semana empieza en lunes). */
function lunesDeSemana(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
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
  const [errorCarga, setErrorCarga] = useState(false);
  const [citasKpi, setCitasKpi] = useState<Cita[] | null>(null);
  const [horarios, setHorarios] = useState<string[]>([]);
  const [verHistorico, setVerHistorico] = useState(false);
  const [lunes, setLunes] = useState(lunesDeSemana(hoyISO()));
  const [nuevaCitaAbierta, setNuevaCitaAbierta] = useState(false);
  const { filtros, cambiar, limpiar } = useFiltrosUrl(ESQUEMA_FILTROS);
  const estadoFiltro = typeof filtros.estado === 'string' ? filtros.estado : undefined;

  const rangoActivo = vista === 'semana'
    ? { desde: lunes, hasta: sumarDias(lunes, 6) }
    : { desde: verHistorico ? undefined : hoyISO(), hasta: undefined };

  const recargar = () => listarCitas(rangoActivo.desde, rangoActivo.hasta)
    .then(c => { setCitas(c); setErrorCarga(false); })
    .catch(() => setErrorCarga(true))
    .finally(() => setCargando(false));
  const recargarKpis = () => listarCitas(hoyISO()).then(setCitasKpi).catch(() => setCitasKpi(null));
  const cargar = () => { setCargando(true); recargar(); recargarKpis(); };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { recargar(); }, [vista, verHistorico, lunes]);
  useEffect(() => { recargarKpis(); }, []);
  useEffect(() => { obtenerHorarios().then(setHorarios).catch(() => setHorarios([])); }, []);

  const kpis = useMemo(() => (citasKpi ? kpisCitas(citasKpi, hoyISO()) : null), [citasKpi]);
  const citasFiltradas = useMemo(
    () => (estadoFiltro ? citas.filter(c => c.estado === estadoFiltro) : citas),
    [citas, estadoFiltro],
  );

  const citasPorDia = useMemo(() => {
    const mapa = new Map<string, Cita[]>();
    for (const c of citasFiltradas) {
      const lista = mapa.get(c.fecha) ?? [];
      lista.push(c);
      mapa.set(c.fecha, lista);
    }
    for (const lista of mapa.values()) lista.sort((a, b) => a.hora.localeCompare(b.hora));
    return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [citasFiltradas]);

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

  const hoyIso = hoyISO();

  return (
    <div>
      <EncabezadoPagina lecturas={LECTURAS.citas}
        titulo="Despachos agendados"
        subtitulo="Citas que proveedores y clientes agendaron desde el portal, o agendadas por el staff."
        acciones={puedeCrear ? (
          <BotonAccion soloEnLinea onClick={() => setNuevaCitaAbierta(true)} icono={<Plus size={18} aria-hidden="true" />}>Agendar</BotonAccion>
        ) : undefined}
      />

      {citasKpi === null && cargando ? (
        <SkeletonKpis cantidad={3} />
      ) : (
        <GrillaKpis>
          <TarjetaKpi
            titulo="Citas de hoy" ayuda="Cuántas citas tienen fecha de hoy y siguen vivas, es decir, que no están canceladas ni completadas (cuenta las pendientes, confirmadas y reprogramadas)."
            valor={kpis ? formatearNumero(kpis.hoy) : '—'} unidad={kpis?.hoy === 1 ? 'cita' : 'citas'}
            subtitulo="Por atender hoy" estado={kpis ? 'listo' : 'vacio'} mensajeVacio="No se pudo cargar"
          />
          <TarjetaKpi
            titulo="Próximos 7 días" ayuda="Cuántas citas vivas hay desde hoy hasta dentro de 6 días (7 días contando hoy). No cuenta las canceladas ni las completadas."
            valor={kpis ? formatearNumero(kpis.proximos7) : '—'} unidad={kpis?.proximos7 === 1 ? 'cita' : 'citas'}
            subtitulo="Incluye las de hoy" estado={kpis ? 'listo' : 'vacio'} mensajeVacio="No se pudo cargar"
          />
          <TarjetaKpi
            titulo="Por confirmar" ayuda="Cuántas citas de hoy en adelante están en estado Pendiente: se pidieron, pero todavía falta que alguien del equipo las confirme."
            valor={kpis ? formatearNumero(kpis.pendientes) : '—'} unidad={kpis?.pendientes === 1 ? 'cita' : 'citas'}
            subtitulo="Sin confirmar, de hoy en adelante" estado={kpis ? 'listo' : 'vacio'} mensajeVacio="No se pudo cargar"
          />
        </GrillaKpis>
      )}

      <Bloque
        titulo={vista === 'semana' ? 'Agenda de la semana' : verHistorico ? 'Histórico de citas' : 'Próximas citas'}
        queEstasViendo={vista === 'semana'
          ? 'Una cuadrícula con las horas en filas y los días en columnas. Cada casilla ocupada muestra quién agendó la cita y en qué estado está.'
          : verHistorico
            ? 'Todas las citas, desde las más antiguas, agrupadas por día.'
            : 'Las citas de hoy en adelante, agrupadas por día y con su estado.'}
        acciones={(
          <div className="flex flex-wrap items-center gap-2">
            {vista === 'lista' && (
              <Chip onClick={() => setVerHistorico(v => !v)} seleccionado={verHistorico}>
                {verHistorico ? 'Mostrando histórico (quitar)' : 'Ver histórico'}
              </Chip>
            )}
            <ControlSegmentado
            etiquetaAria="Vista de las citas"
            valor={vista}
            onCambiar={setVista}
            opciones={[{ valor: 'lista', etiqueta: 'Lista' }, { valor: 'semana', etiqueta: 'Semana' }]}
          />
          </div>
        )}
      >
        <div className="mb-3">
          <FiltrosBarra
            selectores={[{ id: 'citas-estado', etiqueta: 'Estado', valor: estadoFiltro, opciones: OPCIONES_ESTADO, onCambiar: v => cambiar({ estado: v }), textoTodas: 'Todos' }]}
            onLimpiar={limpiar}
          />
        </div>

        {cargando ? (
          <SkeletonBloque alto="h-64" etiqueta="Cargando citas" />
        ) : errorCarga ? (
          <EstadoVacio mensaje="No se pudieron cargar las citas." descripcion="Revisa tu conexión e inténtalo de nuevo." accion={{ etiqueta: 'Reintentar', onClick: cargar }} />
        ) : vista === 'semana' ? (
          <AgendaSemana
            lunes={lunes}
            horarios={horarios}
            citas={citasFiltradas}
            onSemanaAnterior={() => setLunes(l => sumarDias(l, -7))}
            onSemanaSiguiente={() => setLunes(l => sumarDias(l, 7))}
            onVerCita={() => setVista('lista')}
          />
        ) : citasFiltradas.length === 0 ? (
          estadoFiltro ? (
            <EstadoVacio mensaje="Ninguna cita coincide con el filtro." accion={{ etiqueta: 'Quitar filtro', onClick: limpiar }} />
          ) : (
            <EstadoVacio
              mensaje={verHistorico ? 'Aún no hay citas registradas.' : 'No hay citas próximas.'}
              descripcion="Las citas aparecen cuando un proveedor o cliente agenda desde el portal, o cuando el staff agenda una."
              accion={puedeCrear ? { etiqueta: 'Agendar una cita', onClick: () => setNuevaCitaAbierta(true), soloEnLinea: true } : undefined}
            />
          )
        ) : (
          <div className="space-y-6">
            {citasPorDia.map(([fecha, citasDelDia]) => (
              <section key={fecha} aria-label={fmtFecha(fecha)}>
                <h3 className="sticky top-0 mb-2 flex items-center gap-2 bg-surface-alt py-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  {fmtFecha(fecha)}
                  {fecha === hoyIso && <Insignia tono="marca" forma="cuadrada">Hoy</Insignia>}
                </h3>
                <ul className="overflow-hidden rounded-xl border border-border bg-surface">
                  {citasDelDia.map(c => (
                    <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3 last:border-b-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
                        {c.entidadTipo === 'proveedor' ? <Truck size={16} aria-label="Proveedor" /> : <Contact size={16} aria-label="Cliente" />}
                      </div>
                      <div className="min-w-0 flex-1 basis-40">
                        <p className="truncate text-sm font-medium text-text-primary">{c.nombreEntidad}</p>
                        <p className="text-xs text-text-secondary tabular-nums">{c.hora} · {c.entidadTipo === 'proveedor' ? 'Proveedor' : 'Cliente'}</p>
                      </div>
                      <Insignia tono={INFO_ESTADO_CITA[c.estado].tono} title={INFO_ESTADO_CITA[c.estado].ayuda}>{INFO_ESTADO_CITA[c.estado].texto}</Insignia>
                      {puedeEditar && !['cancelada', 'completada'].includes(c.estado) && (
                        <div className="flex shrink-0 items-center gap-1">
                          {c.estado === 'pendiente' && (
                            <button type="button" onClick={() => cambiarEstado(c, 'confirmada')} className={`${BOTON_ICONO} hover:text-green-600`} title="Confirmar" aria-label={`Confirmar cita de ${c.nombreEntidad}`}>
                              <Check size={15} aria-hidden="true" />
                            </button>
                          )}
                          <button type="button" onClick={() => cambiarEstado(c, 'completada')} className={`${BOTON_ICONO} hover:text-brand-600`} title="Marcar como completada" aria-label={`Marcar como completada la cita de ${c.nombreEntidad}`}>
                            <CheckCheck size={15} aria-hidden="true" />
                          </button>
                          <button type="button" onClick={() => cambiarEstado(c, 'cancelada')} className={`${BOTON_ICONO} hover:text-red-600`} title="Cancelar" aria-label={`Cancelar cita de ${c.nombreEntidad}`}>
                            <X size={15} aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Bloque>

      {nuevaCitaAbierta && (
        <NuevaCitaModal onClose={() => setNuevaCitaAbierta(false)} onAgendada={cargar} />
      )}
    </div>
  );
}

export default CitasPage;
