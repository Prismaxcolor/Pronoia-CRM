import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, EyeOff, Eye, Trash2, Car } from 'lucide-react';
import { obtenerVehiculos, desactivarVehiculo, reactivarVehiculo, eliminarVehiculo } from '../../services/vehiculo-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { useConfirm } from '../../hooks/use-confirm-context';
import VehiculoFormModal from './VehiculoFormModal';
import VisorFotos from '../../components/VisorFotos';
import {
  EncabezadoPagina, Bloque, BotonAccion, GrillaKpis, TarjetaKpi, FiltrosBarra, EstadoVacio, SkeletonKpis, SkeletonBloque,
  Insignia, useFiltrosUrl, formatearNumero,
} from '../../components/ui';
import { coincideEstadoActivo, coincideTexto, kpisVehiculos } from '../../lib/catalogos-kpis';
import { etiquetaVehiculo } from '../../lib/vehiculo';
import type { Vehiculo } from '@shared/types/index.js';

/** Datos secundarios en una línea: marca, modelo, color, chofer y descripción. */
function detalle(v: Vehiculo): string {
  return [v.marca, v.modelo, v.color, v.conductor ? `Chofer: ${v.conductor}` : null, v.descripcion].filter(Boolean).join(' · ');
}

const ESQUEMA_FILTROS = {
  campos: { q: { tipo: 'texto' }, estado: { tipo: 'opcion', opciones: ['activos', 'inactivos'] } },
} as const;

const OPCIONES_ESTADO = [{ valor: 'activos', etiqueta: 'Activos' }, { valor: 'inactivos', etiqueta: 'Inactivos' }];
const botonIcono = 'inline-flex h-9 w-9 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';

function VehiculosPage() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const confirmar = useConfirm();
  const puedeCrear = tienePermiso('vehiculos', 'crear');
  const puedeEditar = tienePermiso('vehiculos', 'editar');
  const puedeEliminar = tienePermiso('vehiculos', 'eliminar');

  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(false);
  const [visor, setVisor] = useState<{ fotos: string[]; indice: number } | null>(null);
  const [formAbierto, setFormAbierto] = useState<{ abierto: true; vehiculo: Vehiculo | null } | { abierto: false }>({ abierto: false });
  const { filtros, cambiar, limpiar } = useFiltrosUrl(ESQUEMA_FILTROS);

  const recargar = () => obtenerVehiculos()
    .then(v => { setVehiculos(v); setErrorCarga(false); })
    .catch(() => setErrorCarga(true))
    .finally(() => setCargando(false));
  const cargar = () => { setCargando(true); recargar(); };

  useEffect(() => { recargar(); }, []);

  const cambiarEstado = async (v: Vehiculo, activar: boolean) => {
    const result = activar ? await reactivarVehiculo(v.id) : await desactivarVehiculo(v.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${v.nombre}" ${activar ? 'reactivado' : 'desactivado'}.`);
    cargar();
  };

  const handleEliminar = async (v: Vehiculo) => {
    const ok = await confirmar({
      titulo: 'Eliminar vehículo',
      mensaje: `¿Eliminar "${v.nombre}" de la lista? Los tickets ya registrados conservan su placa.`,
      confirmarLabel: 'Eliminar',
      variante: 'danger',
    });
    if (!ok) return;
    const result = await eliminarVehiculo(v.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${v.nombre}" eliminado.`);
    cargar();
  };

  const kpis = useMemo(() => kpisVehiculos(vehiculos), [vehiculos]);
  const q = typeof filtros.q === 'string' ? filtros.q : undefined;
  const estado = typeof filtros.estado === 'string' ? filtros.estado : undefined;
  const visibles = useMemo(
    () => vehiculos.filter(v => coincideEstadoActivo(v.activo, estado)
      && coincideTexto([v.placa, v.nombre, v.marca, v.modelo, v.color, v.conductor, v.descripcion], q)),
    [vehiculos, q, estado],
  );
  const hayFiltros = Boolean(q || estado);

  return (
    <div>
      <EncabezadoPagina
        titulo="Vehículos"
        subtitulo="Lista de vehículos propios (global) para elegir al pesar. Los vehículos de terceros se escriben a mano en el pesaje y no se guardan aquí."
        acciones={puedeCrear ? (
          <BotonAccion onClick={() => setFormAbierto({ abierto: true, vehiculo: null })} icono={<Plus size={18} aria-hidden="true" />}>Nuevo vehículo</BotonAccion>
        ) : undefined}
      />

      {cargando && vehiculos.length === 0 ? (
        <>
          <SkeletonKpis />
          <SkeletonBloque alto="h-64" etiqueta="Cargando vehículos" />
        </>
      ) : errorCarga && vehiculos.length === 0 ? (
        <EstadoVacio mensaje="No se pudieron cargar los vehículos." descripcion="Revisa tu conexión e inténtalo de nuevo." accion={{ etiqueta: 'Reintentar', onClick: cargar }} />
      ) : (
        <>
          <GrillaKpis>
            <TarjetaKpi
              titulo="Vehículos propios" ayuda="Cuántos vehículos de la empresa hay guardados en esta lista, activos e inactivos. Son los que se pueden elegir al pesar."
              valor={formatearNumero(kpis.total)} unidad={kpis.total === 1 ? 'vehículo' : 'vehículos'} subtitulo="Registrados en la lista"
            />
            <TarjetaKpi
              titulo="Disponibles para pesar" ayuda="Cuántos vehículos están activos, es decir, los que aparecen al elegir vehículo en el pesaje. Los inactivos se guardan, pero no se ofrecen."
              valor={formatearNumero(kpis.activos)} unidad={kpis.activos === 1 ? 'activo' : 'activos'}
              subtitulo={`${formatearNumero(kpis.inactivos)} ${kpis.inactivos === 1 ? 'inactivo' : 'inactivos'}`}
            />
            <TarjetaKpi
              titulo="Sin foto" ayuda="Cuántos vehículos de la lista no tienen ninguna foto (cuenta activos e inactivos). Una foto ayuda a reconocerlos al elegirlos en el pesaje."
              valor={formatearNumero(kpis.sinFoto)} unidad={kpis.sinFoto === 1 ? 'vehículo' : 'vehículos'}
              subtitulo={kpis.sinFoto === 0 ? 'Todos tienen foto' : 'Puedes agregarla al editarlos'}
            />
            <TarjetaKpi
              titulo="De terceros" ayuda="Los vehículos de otras personas o empresas se escriben a mano en cada pesaje y no se guardan en esta lista, por eso aquí no hay una cifra."
              estado="vacio" mensajeVacio="No se guardan aquí: se escriben a mano en el pesaje"
            />
          </GrillaKpis>

          <Bloque titulo="Vehículos propios" queEstasViendo="Cada vehículo propio con su placa, foto y datos. Toca la foto para verla ampliada. Puedes buscar por placa, nombre, marca o chofer.">
            <div className="mb-3">
              <FiltrosBarra
                buscador={{ id: 'vehiculos-q', valor: q, onCambiar: v => cambiar({ q: v }), placeholder: 'Buscar por placa, nombre, marca o chofer', etiqueta: 'Buscar vehículo' }}
                selectores={[{ id: 'vehiculos-estado', etiqueta: 'Estado', valor: estado, opciones: OPCIONES_ESTADO, onCambiar: v => cambiar({ estado: v }), textoTodas: 'Todos' }]}
                onLimpiar={limpiar}
              />
            </div>

            {visibles.length === 0 ? (
              hayFiltros ? (
                <EstadoVacio mensaje="Ningún vehículo coincide con los filtros." accion={{ etiqueta: 'Quitar filtros', onClick: limpiar }} />
              ) : (
                <EstadoVacio
                  mensaje="Aún no hay vehículos registrados."
                  descripcion="Registra los vehículos de la empresa para elegirlos con un toque al pesar, en vez de escribir la placa cada vez."
                  icono={<Car size={22} />}
                  accion={puedeCrear ? { etiqueta: 'Registrar el primer vehículo', onClick: () => setFormAbierto({ abierto: true, vehiculo: null }) } : undefined}
                />
              )
            ) : (
              <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
                {visibles.map(v => (
                  <li key={v.id} className={`rounded-xl border border-border bg-surface p-3 ${!v.activo ? 'opacity-60' : ''}`}>
                    <div className="flex items-start gap-3">
                      {v.fotos[0] ? (
                        <button
                          type="button"
                          onClick={() => setVisor({ fotos: v.fotos, indice: 0 })}
                          className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                          title="Ver fotos"
                          aria-label={`Ver fotos de ${etiquetaVehiculo(v)}`}
                        >
                          <img src={v.fotos[0]} alt={`Foto de ${etiquetaVehiculo(v)}`} className="h-full w-full object-cover" />
                          {v.fotos.length > 1 && (
                            <span className="absolute bottom-0 right-0 rounded-tl bg-black/60 px-1 text-[10px] text-white">{v.fotos.length}</span>
                          )}
                        </button>
                      ) : (
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
                          <Car size={22} aria-hidden="true" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <h3 className="truncate text-sm font-semibold text-text-primary">{v.placa ?? v.nombre}</h3>
                          <Insignia tono={v.activo ? 'exito' : 'neutral'} forma="cuadrada">{v.activo ? 'Activo' : 'Inactivo'}</Insignia>
                        </div>
                        {v.placa && <p className="truncate text-sm text-text-secondary">{v.nombre}</p>}
                        {detalle(v) && <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">{detalle(v)}</p>}
                      </div>
                    </div>
                    {(puedeEditar || puedeEliminar) && (
                      <div className="mt-2 flex items-center justify-end gap-1 border-t border-border pt-2">
                        {puedeEditar && (
                          <>
                            <button type="button" onClick={() => setFormAbierto({ abierto: true, vehiculo: v })} className={`${botonIcono} hover:text-brand-600`} title="Editar vehículo" aria-label={`Editar vehículo ${v.placa ?? v.nombre}`}>
                              <Pencil size={15} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => cambiarEstado(v, !v.activo)}
                              className={`${botonIcono} ${v.activo ? 'hover:text-amber-600' : 'hover:text-green-600'}`}
                              title={v.activo ? 'Desactivar' : 'Reactivar'}
                              aria-label={`${v.activo ? 'Desactivar' : 'Reactivar'} vehículo ${v.placa ?? v.nombre}`}
                            >
                              {v.activo ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                            </button>
                          </>
                        )}
                        {puedeEliminar && (
                          <button type="button" onClick={() => handleEliminar(v)} className={`${botonIcono} hover:text-red-600`} title="Eliminar" aria-label={`Eliminar vehículo ${v.placa ?? v.nombre}`}>
                            <Trash2 size={15} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Bloque>
        </>
      )}

      {visor && (
        <VisorFotos fotos={visor.fotos} indice={visor.indice} onCambiar={i => setVisor({ ...visor, indice: i })} onCerrar={() => setVisor(null)} alt="Foto del vehículo ampliada" />
      )}

      {formAbierto.abierto && (
        <VehiculoFormModal
          vehiculo={formAbierto.vehiculo}
          onClose={() => setFormAbierto({ abierto: false })}
          onGuardado={() => { setFormAbierto({ abierto: false }); cargar(); }}
        />
      )}
    </div>
  );
}

export default VehiculosPage;
