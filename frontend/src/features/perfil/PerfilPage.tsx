import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertCircle, AppWindow, LogOut, Palette, Send, Wifi } from 'lucide-react';
import { useAuth } from '../../hooks/use-auth-context';
import { useEstadoConexion } from '../../lib/offline/conexion';
import { useCola } from '../../lib/offline/cola';
import { useVersionRemota } from '../../lib/offline/use-version-remota';
import { formatearFechaNegocio } from '../../lib/fecha-negocio';
import { COLOR_TEMA } from '../../lib/tema-marca';
import { etiquetaRol, iniciales, motivosDeAviso, TEXTO_AVISO } from '../../lib/perfil-logica';
import TelegramPerfil from '../../components/TelegramPerfil';
import PinOfflinePerfil from '../../components/PinOfflinePerfil';
import BuscarActualizacionPerfil from '../../components/BuscarActualizacionPerfil';
import TarjetaPerfil from './TarjetaPerfil';

/** Pantalla de perfil: datos de la cuenta, conexión, Telegram, apariencia, versión de la app y cierre de sesión. */
function PerfilPage() {
  const { usuario, offlineActivo, logout, tienePermiso } = useAuth();
  const { online } = useEstadoConexion();
  const { pendientes, rechazadas } = useCola();
  const { estado } = useVersionRemota();
  const { hash } = useLocation();

  // Permite enlazar directo a una tarjeta (/perfil#telegram).
  useEffect(() => {
    if (!hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [hash]);

  if (!usuario) return null;

  const avisos = motivosDeAviso({
    hayVersionNueva: estado !== 'al-dia',
    esSuperadmin: usuario.rol === 'superadmin',
    telegramVinculado: Boolean(usuario.telegramVinculado),
    pendientes: pendientes.length,
    rechazadas: rechazadas.length,
  });
  const marcaAzul = usuario.temaMarca === 'azul';

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="sr-only">Mi perfil</h1>

      <section aria-label="Datos de la cuenta" className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4 sm:p-5">
        <div
          aria-hidden="true"
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand-600 text-2xl font-bold text-text-on-brand"
        >
          {iniciales(usuario.nombre)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xl font-semibold text-text-primary">{usuario.nombre}</p>
          <p className="truncate text-sm text-text-secondary">{usuario.email}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-semibold text-brand-800">
              {etiquetaRol(usuario.rol)}
            </span>
            {usuario.creadoEn && (
              <span className="text-xs text-text-secondary">Miembro desde {formatearFechaNegocio(usuario.creadoEn)}</span>
            )}
          </div>
        </div>
      </section>

      {avisos.length > 0 && (
        <section aria-label="Pendientes de atender" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="mb-1 flex items-center gap-2 font-semibold">
            <AlertCircle size={16} aria-hidden="true" />
            Algo por atender
          </p>
          <ul className="list-disc space-y-0.5 pl-6">
            {avisos.map(m => <li key={m}>{TEXTO_AVISO[m]}</li>)}
          </ul>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2 md:items-start">
        <TarjetaPerfil id="conexion" titulo="Conexión y modo sin conexión" icono={<Wifi size={18} />}>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-text-secondary">Estado</dt>
              <dd className={`font-medium ${online ? 'text-brand-700' : 'text-amber-700'}`}>{online ? 'En línea' : 'Sin conexión'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-text-secondary">Modo sin conexión</dt>
              <dd className="font-medium text-text-primary">{offlineActivo ? 'Activo' : 'No activo'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-text-secondary">Pendientes de envío</dt>
              <dd className="font-medium text-text-primary">
                {pendientes.length}
                {rechazadas.length > 0 && <span className="text-red-700"> · {rechazadas.length} rechazada{rechazadas.length === 1 ? '' : 's'}</span>}
              </dd>
            </div>
          </dl>
          {(pendientes.length > 0 || rechazadas.length > 0) && (
            <Link to="/pendientes" className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline underline-offset-2">
              Ver pendientes
            </Link>
          )}
          {offlineActivo && (
            <div className="mt-3 border-t border-border pt-3">
              <PinOfflinePerfil />
            </div>
          )}
        </TarjetaPerfil>

        <TarjetaPerfil id="telegram" titulo="Telegram" icono={<Send size={18} />}>
          <TelegramPerfil />
        </TarjetaPerfil>

        <TarjetaPerfil id="apariencia" titulo="Apariencia" icono={<Palette size={18} />}>
          <p className="flex items-center gap-2 text-sm text-text-primary">
            <span
              aria-hidden="true"
              className="inline-block h-4 w-4 rounded-full border border-border-strong"
              style={{ backgroundColor: marcaAzul ? COLOR_TEMA.azul : COLOR_TEMA.verde }}
            />
            Color de la marca: <span className="font-medium">{marcaAzul ? 'Azul' : 'Verde (predeterminado)'}</span>
          </p>
          <p className="mt-1 text-xs text-text-secondary">El color lo asigna un administrador desde la gestión de usuarios.</p>
          {tienePermiso('usuarios', 'ver') && (
            <Link to="/usuarios" className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline underline-offset-2">
              Ir a Usuarios
            </Link>
          )}
        </TarjetaPerfil>

        <TarjetaPerfil id="aplicacion" titulo="Aplicación" icono={<AppWindow size={18} />}>
          <BuscarActualizacionPerfil />
        </TarjetaPerfil>

        <TarjetaPerfil id="sesion" titulo="Sesión" icono={<LogOut size={18} />}>
          <p className="text-sm text-text-secondary">Si tienes envíos pendientes o borradores, te avisaremos antes de salir para que no pierdas nada.</p>
          <button
            type="button"
            onClick={() => void logout()}
            className="mt-3 flex min-h-11 items-center gap-2 rounded-lg border border-red-300 px-4 text-sm font-medium text-red-700 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            <LogOut size={16} aria-hidden="true" />
            Cerrar sesión
          </button>
        </TarjetaPerfil>
      </div>
    </div>
  );
}

export default PerfilPage;
