import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Users } from 'lucide-react';
import { actualizarTrabajador, desactivarTrabajador, obtenerTrabajadores } from '../../services/nomina-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { BotonAccion, EstadoVacio, Insignia, SkeletonBloque, useConfirm } from '../../components/ui';
import { ETIQUETA_TIPO_TRABAJADOR, nombreCompleto, type TipoTrabajador, type Trabajador } from '@shared/types/nomina';
import CargoTrabajadorModal from './CargoTrabajadorModal';
import TrabajadorFormModal from './TrabajadorFormModal';

interface Props {
  tipo: TipoTrabajador;
}

type Modal = { abierto: false } | { abierto: true; trabajador: Trabajador | null };

const fmtUsd = (n: number) => `USD ${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtBs = (n: number) => `Bs ${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Los dos sueldos diarios: el de divisas y el de bolívares (solo se nombra el que tenga monto). */
function sueldoPorDia(t: Trabajador): string {
  const partes = [t.pagoDiarioUsd > 0 || t.pagoDiarioBs === 0 ? fmtUsd(t.pagoDiarioUsd) : null, t.pagoDiarioBs > 0 ? fmtBs(t.pagoDiarioBs) : null];
  return `${partes.filter(Boolean).join(' + ')} por día`;
}

function medioDePago(t: Trabajador): string {
  const partes = [t.pagoMovilTelefono ? `Pago móvil${t.pagoMovilBanco ? ` (${t.pagoMovilBanco})` : ''}` : null, t.binanceCorreoId ? 'Binance' : null];
  return partes.filter(Boolean).join(' · ') || 'Sin datos de pago';
}

function Detalle({ t }: { t: Trabajador }) {
  const filas: Array<[string, string | null]> = [
    ['RIF', t.rif], ['Dirección', t.direccion],
    ['Contacto de emergencia', [t.contactoEmergenciaNombre, t.contactoEmergenciaTelefono].filter(Boolean).join(' · ') || null],
    ['Pago móvil', t.pagoMovilTelefono ? [t.pagoMovilBanco, t.pagoMovilTelefono, t.pagoMovilCedula].filter(Boolean).join(' · ') : null],
    ['Binance', t.binanceCorreoId],
  ];
  return (
    <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 border-t border-border pt-3 text-sm sm:grid-cols-2">
      {filas.map(([etiqueta, valor]) => (
        <div key={etiqueta}>
          <dt className="text-xs text-text-secondary">{etiqueta}</dt>
          <dd className="text-text-primary break-words">{valor ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

function PersonalPanel({ tipo }: Props) {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const confirmar = useConfirm();
  const puedeCrear = tienePermiso('nomina', 'crear');
  const puedeEditar = tienePermiso('nomina', 'editar');
  const puedeEliminar = tienePermiso('nomina', 'eliminar');
  const [trabajadores, setTrabajadores] = useState<Trabajador[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [verInactivos, setVerInactivos] = useState(false);
  const [modal, setModal] = useState<Modal>({ abierto: false });
  const [cargoDe, setCargoDe] = useState<Trabajador | null>(null);

  const cargar = useCallback(async () => {
    const r = await obtenerTrabajadores(tipo, verInactivos);
    if ('error' in r) setError(r.error);
    else { setTrabajadores(r.trabajadores); setError(null); }
    setCargando(false);
  }, [tipo, verInactivos]);

  useEffect(() => {
    // Carga inicial y al cambiar el filtro: el estado se actualiza tras el await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return q ? trabajadores.filter(t => `${nombreCompleto(t)} ${t.cedula}`.toLowerCase().includes(q)) : trabajadores;
  }, [trabajadores, busqueda]);

  const cambiarActivo = async (t: Trabajador, activar: boolean) => {
    if (!activar && !(await confirmar({
      titulo: 'Desactivar trabajador',
      mensaje: `${nombreCompleto(t)} dejará de aparecer en las nóminas nuevas. Sus nóminas y préstamos anteriores se conservan y puedes reactivarlo cuando quieras.`,
      confirmarLabel: 'Desactivar', variante: 'warning',
    }))) return;
    const r = activar ? await actualizarTrabajador(t.id, { activo: true }) : await desactivarTrabajador(t.id);
    if ('error' in r) { toast.errorMsg(r.error); return; }
    toast.exito(`${nombreCompleto(t)} ${activar ? 'reactivado' : 'desactivado'}.`);
    await cargar();
  };

  const alGuardar = async () => { setModal({ abierto: false }); await cargar(); };
  const nuevo = () => setModal({ abierto: true, trabajador: null });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search" value={busqueda} onChange={e => setBusqueda(e.target.value)} aria-label="Buscar trabajador"
          placeholder="Buscar por nombre o cédula"
          className="flex-1 min-w-[220px] px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" checked={verInactivos} onChange={e => { setVerInactivos(e.target.checked); setCargando(true); }} />
          Ver inactivos
        </label>
        {puedeCrear && <BotonAccion icono={<Plus size={16} />} onClick={nuevo}>Nuevo trabajador</BotonAccion>}
      </div>

      {cargando ? <SkeletonBloque /> : error ? (
        <div role="alert" className="rounded-xl border border-border bg-surface p-4 text-sm text-red-500">
          {error}
          <button type="button" onClick={() => { setCargando(true); void cargar(); }} className="ml-3 underline">Reintentar</button>
        </div>
      ) : visibles.length === 0 ? (
        <EstadoVacio
          icono={<Users size={32} />}
          mensaje={trabajadores.length === 0 ? `Aún no hay ${ETIQUETA_TIPO_TRABAJADOR[tipo].toLowerCase()} registrado` : 'Ningún trabajador coincide con la búsqueda'}
          descripcion={trabajadores.length === 0 ? 'Registra a las personas para poder cargar su nómina semanal.' : undefined}
          accion={trabajadores.length === 0 && puedeCrear ? { etiqueta: 'Nuevo trabajador', onClick: nuevo } : undefined}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {visibles.map(t => (
            <li key={t.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-text-primary break-words">
                    {nombreCompleto(t)} {!t.activo && <Insignia tono="neutral">Inactivo</Insignia>}
                  </p>
                  <p className="mt-0.5 text-xs text-text-secondary">Cédula {t.cedula} · {t.telefono ?? 'sin teléfono'}</p>
                  <p className="mt-0.5 text-xs text-text-secondary">{sueldoPorDia(t)} · {medioDePago(t)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <button type="button" aria-label={`Ver el cargo de ${nombreCompleto(t)}`} onClick={() => setCargoDe(t)} className="text-xs text-brand-700 underline">Ver cargo</button>
                  {puedeEditar && (
                    <button type="button" aria-label={`Editar ${nombreCompleto(t)}`} onClick={() => setModal({ abierto: true, trabajador: t })} className="text-text-muted hover:text-text-primary">
                      <Pencil size={16} />
                    </button>
                  )}
                  {t.activo && puedeEliminar && (
                    <button type="button" onClick={() => void cambiarActivo(t, false)} className="text-xs text-text-secondary underline hover:text-text-primary">Desactivar</button>
                  )}
                  {!t.activo && puedeEditar && (
                    <button type="button" onClick={() => void cambiarActivo(t, true)} className="text-xs text-brand-700 underline">Reactivar</button>
                  )}
                </div>
              </div>
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-xs font-medium text-brand-700">Ver todos los datos</summary>
                <Detalle t={t} />
              </details>
            </li>
          ))}
        </ul>
      )}

      {cargoDe && <CargoTrabajadorModal trabajador={cargoDe} onClose={() => setCargoDe(null)} />}
      {modal.abierto && <TrabajadorFormModal tipo={tipo} trabajador={modal.trabajador} onClose={() => setModal({ abierto: false })} onGuardado={alGuardar} />}
    </div>
  );
}

export default PersonalPanel;
