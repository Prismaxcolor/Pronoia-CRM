import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Shield, UserX, UserCheck, Trash2, Palette } from 'lucide-react';
import {
  obtenerUsuarios,
  desactivarUsuario,
  reactivarUsuario,
  borrarUsuario,
} from '../../services/usuario-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { useConfirm } from '../../hooks/use-confirm-context';
import CrearUsuarioModal from './CrearUsuarioModal';
import EditarPermisosModal from './EditarPermisosModal';
import EditarUsuarioModal from './EditarUsuarioModal';
import {
  EncabezadoPagina, Bloque, BotonAccion, GrillaKpis, TarjetaKpi, FiltrosBarra, EstadoVacio, SkeletonKpis, SkeletonBloque,
  Insignia, useFiltrosUrl, formatearNumero,
} from '../../components/ui';
import type { Tono } from '../../components/ui';
import { coincideEstadoActivo, coincideTexto, kpisUsuarios } from '../../lib/catalogos-kpis';
import type { Usuario } from '@shared/types/index.js';

const ROL_INFO: Record<string, { etiqueta: string; tono: Tono }> = {
  superadmin: { etiqueta: 'Superadmin', tono: 'marca' },
  administracion: { etiqueta: 'Administración', tono: 'info' },
  trabajador: { etiqueta: 'Trabajador', tono: 'neutral' },
};

const ESQUEMA_FILTROS = {
  campos: {
    q: { tipo: 'texto' },
    rol: { tipo: 'opcion', opciones: ['superadmin', 'administracion', 'trabajador'] },
    estado: { tipo: 'opcion', opciones: ['activos', 'inactivos'] },
  },
} as const;

const OPCIONES_ROL = [
  { valor: 'superadmin', etiqueta: 'Superadmin' },
  { valor: 'administracion', etiqueta: 'Administración' },
  { valor: 'trabajador', etiqueta: 'Trabajador' },
];
const OPCIONES_ESTADO = [{ valor: 'activos', etiqueta: 'Activos' }, { valor: 'inactivos', etiqueta: 'Inactivos' }];
const BOTON_ICONO = 'inline-flex h-9 w-9 items-center justify-center rounded-lg text-text-muted transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';

function UsuariosPage() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(false);
  const { filtros, cambiar, limpiar } = useFiltrosUrl(ESQUEMA_FILTROS);
  const [mostrarCrear, setMostrarCrear] = useState(false);
  const [editando, setEditando] = useState<Usuario | null>(null);
  const [editandoDatos, setEditandoDatos] = useState<Usuario | null>(null);
  const { usuario: currentUser } = useAuth();
  const toast = useToast();
  const confirmar = useConfirm();

  const recargar = () => obtenerUsuarios()
    .then(u => { setUsuarios(u); setErrorCarga(false); })
    .catch(() => setErrorCarga(true))
    .finally(() => setCargando(false));
  const cargar = () => { setCargando(true); recargar(); };

  useEffect(() => { recargar(); }, []);

  const handleDesactivar = async (u: Usuario) => {
    if (u.id === currentUser?.id) return;
    const ok = await confirmar({
      titulo: `Desactivar a ${u.nombre}`,
      mensaje: 'El usuario no podrá iniciar sesión, pero su historial financiero se conserva. Podrás reactivarlo más adelante.',
      confirmarLabel: 'Desactivar',
      variante: 'warning',
    });
    if (!ok) return;
    const result = await desactivarUsuario(u.id);
    if ('error' in result) {
      toast.errorMsg(result.error);
      return;
    }
    toast.exito(`${u.nombre} desactivado.`);
    cargar();
  };

  const handleReactivar = async (u: Usuario) => {
    const result = await reactivarUsuario(u.id);
    if ('error' in result) {
      toast.errorMsg(result.error);
      return;
    }
    toast.exito(`${u.nombre} reactivado.`);
    cargar();
  };

  const handleBorrar = async (u: Usuario) => {
    if (u.id === currentUser?.id) return;
    const ok = await confirmar({
      titulo: `Borrar a ${u.nombre} definitivamente`,
      mensaje: `Esta acción es irreversible. Solo se permite si el usuario NO tiene movimientos ni facturas asociados.\n\nSi tiene historial financiero, mantenlo desactivado en su lugar.`,
      confirmarLabel: 'Borrar definitivamente',
      variante: 'danger',
    });
    if (!ok) return;
    const result = await borrarUsuario(u.id);
    if ('error' in result) {
      toast.errorMsg(result.error);
      return;
    }
    toast.exito(`${u.nombre} eliminado de la base de datos.`);
    cargar();
  };

  const kpis = useMemo(() => kpisUsuarios(usuarios), [usuarios]);
  const q = typeof filtros.q === 'string' ? filtros.q : undefined;
  const rolFiltro = typeof filtros.rol === 'string' ? filtros.rol : undefined;
  const estadoFiltro = typeof filtros.estado === 'string' ? filtros.estado : undefined;
  const visibles = useMemo(
    () => usuarios.filter(u => coincideEstadoActivo(u.activo, estadoFiltro)
      && (!rolFiltro || u.rol === rolFiltro)
      && coincideTexto([u.nombre, u.email], q)),
    [usuarios, q, rolFiltro, estadoFiltro],
  );
  const hayFiltros = Boolean(q || rolFiltro || estadoFiltro);
  const activosDe = (rol: string) => kpis.activosPorRol[rol] ?? 0;

  return (
    <div>
      <EncabezadoPagina
        titulo="Usuarios"
        subtitulo="Gestiona roles y permisos del equipo"
        acciones={(
          <BotonAccion onClick={() => setMostrarCrear(true)} icono={<Plus size={18} aria-hidden="true" />}>Nuevo usuario</BotonAccion>
        )}
      />

      {cargando && usuarios.length === 0 ? (
        <>
          <SkeletonKpis />
          <SkeletonBloque alto="h-64" etiqueta="Cargando usuarios" />
        </>
      ) : errorCarga && usuarios.length === 0 ? (
        <EstadoVacio mensaje="No se pudieron cargar los usuarios." descripcion="Revisa tu conexión e inténtalo de nuevo." accion={{ etiqueta: 'Reintentar', onClick: cargar }} />
      ) : (
        <>
          <GrillaKpis>
            <TarjetaKpi
              titulo="Usuarios activos" ayuda="Cuántas personas con la cuenta activa pueden iniciar sesión. Los usuarios desactivados no se cuentan aquí; aparecen en el subtítulo como inactivos."
              valor={formatearNumero(kpis.activos)} unidad={kpis.activos === 1 ? 'usuario' : 'usuarios'}
              subtitulo={`de ${formatearNumero(kpis.total)} registrados · ${formatearNumero(kpis.inactivos)} inactivos`}
            />
            <TarjetaKpi
              titulo="Superadmin" ayuda="Cuántos usuarios activos tienen el rol Superadmin: pueden ver y hacer todo en el sistema y no admiten permisos personalizados."
              valor={formatearNumero(activosDe('superadmin'))} unidad={activosDe('superadmin') === 1 ? 'activo' : 'activos'} subtitulo="Acceso total"
            />
            <TarjetaKpi
              titulo="Administración" ayuda="Cuántos usuarios activos tienen el rol Administración. Por defecto manejan facturación, clientes, proveedores, pesaje y wallet, sin acceso a usuarios y sin poder eliminar; sus permisos se pueden personalizar."
              valor={formatearNumero(activosDe('administracion'))} unidad={activosDe('administracion') === 1 ? 'activo' : 'activos'} subtitulo="Permisos según su configuración"
            />
            <TarjetaKpi
              titulo="Trabajadores" ayuda="Cuántos usuarios activos tienen el rol Trabajador. Por defecto trabajan en productos, almacenes, pesaje, traslados y transformaciones, sin acceso a facturación ni usuarios; sus permisos se pueden personalizar."
              valor={formatearNumero(activosDe('trabajador'))} unidad={activosDe('trabajador') === 1 ? 'activo' : 'activos'} subtitulo="Operación diaria"
            />
          </GrillaKpis>

          <Bloque titulo="Equipo" queEstasViendo="Cada persona con su rol (que define qué puede hacer), si está activa, sus permisos y el color con el que ve el sistema. Los botones de cada tarjeta editan sus datos y permisos, o la desactivan.">
            <div className="mb-3">
              <FiltrosBarra
                buscador={{ id: 'usuarios-q', valor: q, onCambiar: v => cambiar({ q: v }), placeholder: 'Buscar por nombre o correo', etiqueta: 'Buscar usuario' }}
                selectores={[
                  { id: 'usuarios-rol', etiqueta: 'Rol', valor: rolFiltro, opciones: OPCIONES_ROL, onCambiar: v => cambiar({ rol: v }), textoTodas: 'Todos' },
                  { id: 'usuarios-estado', etiqueta: 'Estado', valor: estadoFiltro, opciones: OPCIONES_ESTADO, onCambiar: v => cambiar({ estado: v }), textoTodas: 'Todos' },
                ]}
                onLimpiar={limpiar}
              />
            </div>

            {visibles.length === 0 ? (
              hayFiltros ? (
                <EstadoVacio mensaje="Ningún usuario coincide con los filtros." accion={{ etiqueta: 'Quitar filtros', onClick: limpiar }} />
              ) : (
                <EstadoVacio
                  mensaje="Aún no hay usuarios registrados."
                  descripcion="Crea una cuenta para cada persona del equipo y asígnale un rol y los permisos que necesita."
                  accion={{ etiqueta: 'Crear el primer usuario', onClick: () => setMostrarCrear(true) }}
                />
              )
            ) : (
              <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
                {visibles.map(u => {
                  const rol = ROL_INFO[u.rol] ?? ROL_INFO.trabajador;
                  const esYo = u.id === currentUser?.id;
                  return (
                    <li key={u.id} className={`rounded-xl border border-border bg-surface p-4 ${!u.activo ? 'opacity-70' : ''}`}>
                      <div className="flex items-start gap-3">
                        <div aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                          {u.nombre.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-text-primary">
                            {u.nombre} {esYo && <span className="text-xs font-normal text-text-secondary">(tú)</span>}
                          </p>
                          <p className="truncate text-xs text-text-secondary">{u.email}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <Insignia tono={rol.tono}>{rol.etiqueta}</Insignia>
                            <Insignia tono={u.activo ? 'exito' : 'neutral'}>{u.activo ? 'Activo' : 'Inactivo'}</Insignia>
                          </div>
                        </div>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <dt className="text-text-secondary" title="Qué puede ver y hacer. “Los de su rol” significa que no se le personalizó nada; un número indica cuántos permisos sueltos se le asignaron en lugar de los del rol.">Permisos</dt>
                          <dd className="font-medium text-text-primary">
                            {u.rol === 'superadmin' ? 'Todos (acceso total)' : u.permisos.length === 0 ? 'Los de su rol' : `${u.permisos.length} personalizado${u.permisos.length !== 1 ? 's' : ''}`}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-text-secondary" title="Color de la interfaz que ve esta persona. No cambia lo que puede hacer.">Color del sistema</dt>
                          <dd className="flex items-center gap-1 font-medium text-text-primary">
                            <Palette size={12} aria-hidden="true" />
                            {u.temaMarca === 'azul' ? 'Azul' : 'Verde (predeterminado)'}
                          </dd>
                        </div>
                      </dl>
                      <div className="mt-3 flex items-center justify-end gap-1 border-t border-border pt-2">
                        <button type="button" onClick={() => setEditandoDatos(u)} className={`${BOTON_ICONO} hover:bg-brand-50 hover:text-brand-600`} title="Editar usuario" aria-label={`Editar usuario ${u.nombre}`}>
                          <Pencil size={16} aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => setEditando(u)} className={`${BOTON_ICONO} hover:bg-brand-50 hover:text-brand-600`} title="Editar permisos" aria-label={`Editar permisos de ${u.nombre}`}>
                          <Shield size={16} aria-hidden="true" />
                        </button>
                        {!esYo && u.activo && (
                          <button type="button" onClick={() => handleDesactivar(u)} className={`${BOTON_ICONO} hover:bg-amber-50 hover:text-amber-600`} title="Desactivar" aria-label={`Desactivar a ${u.nombre}`}>
                            <UserX size={16} aria-hidden="true" />
                          </button>
                        )}
                        {!esYo && !u.activo && (
                          <>
                            <button type="button" onClick={() => handleReactivar(u)} className={`${BOTON_ICONO} hover:bg-green-50 hover:text-green-600`} title="Reactivar" aria-label={`Reactivar a ${u.nombre}`}>
                              <UserCheck size={16} aria-hidden="true" />
                            </button>
                            <button type="button" onClick={() => handleBorrar(u)} className={`${BOTON_ICONO} hover:bg-red-50 hover:text-red-600`} title="Borrar definitivamente" aria-label={`Borrar definitivamente a ${u.nombre}`}>
                              <Trash2 size={16} aria-hidden="true" />
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Bloque>
        </>
      )}

      {mostrarCrear && (
        <CrearUsuarioModal
          onClose={() => setMostrarCrear(false)}
          onCreado={() => { setMostrarCrear(false); cargar(); }}
        />
      )}

      {editando && (
        <EditarPermisosModal
          usuario={editando}
          onClose={() => setEditando(null)}
          onGuardado={() => { setEditando(null); cargar(); }}
        />
      )}

      {editandoDatos && (
        <EditarUsuarioModal
          usuario={editandoDatos}
          onClose={() => setEditandoDatos(null)}
          onGuardado={() => { setEditandoDatos(null); cargar(); }}
        />
      )}
    </div>
  );
}

export default UsuariosPage;
