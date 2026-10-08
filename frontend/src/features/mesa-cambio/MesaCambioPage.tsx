import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, Pencil, Plus } from 'lucide-react';
import { obtenerCambistas } from '../../services/mesa-cambio-service';
import { useAuth } from '../../hooks/use-auth-context';
import { BotonAccion, EncabezadoPagina, EstadoVacio, SkeletonBloque } from '../../components/ui';
import { describirSaldo, type Cambista, type CambistaConSaldo } from '@shared/types/mesa-cambio';
import CambistaFormModal from './CambistaFormModal';
import SaldoCambista from './SaldoCambista';
import { filtrarCambistas, totalesMesa } from './mesa-cambio-lista';

type ModalCambista = { abierto: false } | { abierto: true; cambista: Cambista | null };

const fmtUsd = (n: number) => `USD ${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function MesaCambioPage() {
  const { tienePermiso } = useAuth();
  const puedeCrear = tienePermiso('mesa_cambio', 'crear');
  const puedeEditar = tienePermiso('mesa_cambio', 'editar');
  const [cambistas, setCambistas] = useState<CambistaConSaldo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [verInactivos, setVerInactivos] = useState(false);
  const [modal, setModal] = useState<ModalCambista>({ abierto: false });

  const cargar = useCallback(async () => {
    const r = await obtenerCambistas();
    if ('error' in r) setError(r.error);
    else { setCambistas(r.cambistas); setError(null); }
    setCargando(false);
  }, []);

  useEffect(() => {
    // Carga inicial: la actualización de estado ocurre tras el await, no de forma síncrona.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  const visibles = useMemo(() => filtrarCambistas(cambistas, { q: busqueda, incluirInactivos: verInactivos }), [cambistas, busqueda, verInactivos]);
  const totales = useMemo(() => totalesMesa(cambistas), [cambistas]);

  const alGuardar = async () => {
    setModal({ abierto: false });
    await cargar();
  };

  return (
    <div>
      <EncabezadoPagina
        titulo="Mesa de cambio"
        subtitulo="Cambistas que nos hacen cambios de divisas y lo que les debemos o nos deben, en USD. Son anotaciones: no mueven Wallet ni bancas."
       
        acciones={puedeCrear && (
          <BotonAccion icono={<Plus size={16} />} onClick={() => setModal({ abierto: true, cambista: null })}>Nuevo cambista</BotonAccion>
        )}
      />

      {cargando ? <SkeletonBloque /> : error ? (
        <div role="alert" className="rounded-xl border border-border bg-surface p-4 text-sm text-red-500">
          {error}
          <button type="button" onClick={() => { setCargando(true); void cargar(); }} className="ml-3 underline">Reintentar</button>
        </div>
      ) : (
        <>
          <section aria-label="Resumen" className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-xs text-text-secondary mb-1">Total que les debemos</p>
              <p className="text-xl font-bold tabular-nums text-text-primary">{fmtUsd(totales.lesDebemos)}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-xs text-text-secondary mb-1">Total que nos deben</p>
              <p className="text-xl font-bold tabular-nums text-text-primary">{fmtUsd(totales.nosDeben)}</p>
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <input
              type="search" value={busqueda} onChange={e => setBusqueda(e.target.value)} aria-label="Buscar cambista"
              placeholder="Buscar por nombre, teléfono o email"
              className="flex-1 min-w-[220px] px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input type="checkbox" checked={verInactivos} onChange={e => setVerInactivos(e.target.checked)} />
              Ver inactivos
            </label>
          </div>

          {visibles.length === 0 ? (
            <EstadoVacio
              icono={<ArrowLeftRight size={32} />}
              mensaje={cambistas.length === 0 ? 'Aún no hay cambistas registrados' : 'Ningún cambista coincide con el filtro'}
              descripcion={cambistas.length === 0 ? 'Registra a quienes te hacen cambios de divisas para llevar su estado de cuenta.' : undefined}
              accion={cambistas.length === 0 && puedeCrear ? { etiqueta: 'Nuevo cambista', onClick: () => setModal({ abierto: true, cambista: null }) } : undefined}
            />
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {visibles.map(c => (
                <li key={c.id} className="rounded-xl border border-border bg-surface p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link to={`/mesa-cambio/${c.id}`} className="font-semibold text-text-primary hover:underline break-words">{c.nombre}</Link>
                      {!c.activo && <span className="ml-2 text-xs text-text-muted">(inactivo)</span>}
                      <p className="text-xs text-text-secondary mt-0.5">{c.telefono || c.email || 'Sin contacto'} · {c.asientos} asiento{c.asientos === 1 ? '' : 's'}</p>
                    </div>
                    {puedeEditar && (
                      <button type="button" aria-label={`Editar ${c.nombre}`} onClick={() => setModal({ abierto: true, cambista: c })} className="text-text-muted hover:text-text-primary">
                        <Pencil size={16} />
                      </button>
                    )}
                  </div>
                  <div aria-label={describirSaldo(c.saldo).texto}><SaldoCambista saldo={c.saldo} variante="bloque" /></div>
                  <Link to={`/mesa-cambio/${c.id}`} className="text-sm font-medium text-brand-600 hover:underline">Ver estado de cuenta</Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {modal.abierto && <CambistaFormModal cambista={modal.cambista} onClose={() => setModal({ abierto: false })} onGuardado={alGuardar} />}
    </div>
  );
}

export default MesaCambioPage;
