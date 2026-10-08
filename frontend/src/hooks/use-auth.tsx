import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { apiFetch, setToken, clearToken, getToken, ApiError, borrarBorradoresLocales, tokenEsDeSesion } from '../services/api-client';
import { limpiarUltimasRutas } from '../services/nav-memory';
import { aplicarTemaMarca, normalizarTemaMarca } from '../lib/tema-marca';
import { PERMISOS_POR_ROL, tienePermiso as checkPermiso } from '@shared/types/index.js';
import type { Usuario, Permiso, Recurso, Accion } from '@shared/types/index.js';
import { AuthContext } from './use-auth-context';
import { estaOnline, useEstadoConexion } from '../lib/offline/conexion';
import { guardarSesionOffline, leerSesionOffline, limpiarSesionOffline, pinOfflineConfigurado } from '../lib/offline/sesion';
import { decidirArranque, mensajeNoVigente, resolverOfflineActivo, type DecisionArranque } from '../lib/offline/sesion-logica';
import { limpiarCacheDeLectura } from '../lib/offline/limpieza-sesion';
import { contarPendientesPorDueno, exportarCola } from '../lib/offline/cola';
import { contarBorradoresDeUsuario, planificarSalida, type PlanSalida } from '../lib/offline/salida-logica';
import { storageSeguro } from '../lib/borrador';
import ConfirmarSalidaModal from '../components/ConfirmarSalidaModal';
import PantallaDesbloqueoPin from '../components/PantallaDesbloqueoPin';

interface UsuarioApi {
  id: string;
  email: string;
  nombre: string;
  rol: Usuario['rol'];
  permisos: Permiso[] | null;
  activo: boolean;
  creadoEn: string;
  temaMarca?: 'azul' | null;
  telegramVinculado?: boolean;
  telegramLinkedAt?: string | null;
  telegramChatId?: string | null;
}

function mapUsuario(api: UsuarioApi): Usuario {
  const permisos = api.permisos && api.permisos.length > 0
    ? api.permisos
    : PERMISOS_POR_ROL[api.rol] ?? [];

  return {
    id: api.id,
    authId: api.id,
    nombre: api.nombre,
    email: api.email,
    rol: api.rol,
    permisos,
    activo: api.activo,
    creadoEn: api.creadoEn,
    temaMarca: normalizarTemaMarca(api.temaMarca),
    telegramVinculado: Boolean(api.telegramVinculado),
    telegramLinkedAt: api.telegramLinkedAt ?? null,
    telegramChatId: api.telegramChatId ?? null,
  };
}

interface AuthResponse {
  token: string;
  usuario: UsuarioApi;
}

interface ConfigOffline {
  activo: boolean;
  ahoraServidor: number;
}

/** Tiempo máximo esperando al servidor al abrir la app; pasado esto se usa la sesión local si es válida. */
const TIMEOUT_ARRANQUE_MS = 5_000;
const MENSAJE_SESION_CERRADA =
  'Tu sesión ya no es válida. Inicia sesión de nuevo; tus pendientes y borradores siguen guardados en este equipo.';
const MENSAJE_PIN_AGOTADO =
  'Demasiados intentos fallidos del PIN: por seguridad se cerró la sesión. Inicia sesión con internet; tus pendientes y borradores siguen guardados en este equipo.';

/** Vacía la caché de lecturas (catálogos y registro) sin tocar la cola ni los borradores. Un fallo no debe impedir salir. */
async function purgarCacheDeLectura(): Promise<void> {
  try {
    await limpiarCacheDeLectura();
  } catch {
    // La salida continúa: lo peor es que la caché quede hasta su tope de edad (7 días).
  }
}

function hayRedAparente(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine;
}

/** /me con timeout. Sin red aparente falla de inmediato con un error de red (sin esperar al timeout). */
async function pedirMe(): Promise<Usuario> {
  if (!hayRedAparente()) throw new TypeError('Sin conexión');
  const { usuario } = await apiFetch<{ usuario: UsuarioApi }>('/api/auth/me', { timeoutMs: TIMEOUT_ARRANQUE_MS });
  return mapUsuario(usuario);
}

/** Interruptor OFFLINE_ACTIVO del servidor. null si no se pudo consultar (se conserva el último valor conocido). */
async function pedirConfigOffline(): Promise<ConfigOffline | null> {
  if (!hayRedAparente()) return null;
  try {
    const cfg = await apiFetch<ConfigOffline>('/api/auth/offline-config', { timeoutMs: TIMEOUT_ARRANQUE_MS });
    return typeof cfg?.activo === 'boolean' ? cfg : null;
  } catch {
    return null;
  }
}

/** Guarda la sesión validada para poder abrir sin red. Nunca interrumpe el flujo online si falla. */
async function recordarSesion(usuario: Usuario, token: string, cfg: ConfigOffline | null): Promise<void> {
  try {
    await guardarSesionOffline(usuario, token, {
      // Sin "Recordarme" el token no se guarda en IndexedDB (la sesión local solo vive en esta pestaña).
      recordar: !tokenEsDeSesion(),
      offlineActivo: cfg?.activo,
      desfaseRelojMs: cfg ? cfg.ahoraServidor - Date.now() : undefined,
    });
  } catch {
    // Degradación segura: sin sesión local la app se comporta como siempre.
  }
}

function contarBorradores(usuarioId: string): number {
  return contarBorradoresDeUsuario(storageSeguro(false), usuarioId)
    + contarBorradoresDeUsuario(storageSeguro(true), usuarioId);
}

interface SalidaPendiente {
  plan: PlanSalida;
  pendientes: number | null;
  borradores: number;
  resolver: () => void;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  // Sin token no hay nada que cargar — se resuelve en el estado inicial (el
  // token ya está disponible de forma síncrona vía localStorage) en vez de
  // vía setState síncrono dentro del efecto.
  const [cargando, setCargando] = useState(() => !!getToken());
  const [error, setError] = useState<string | null>(null);
  const [sesionLocal, setSesionLocal] = useState(false);
  const [offlineActivo, setOfflineActivo] = useState(false);
  const [bloqueado, setBloqueado] = useState(false);
  // Hay token pero no se pudo validar ni usar sesión local: se reintenta al volver la red.
  const [tokenSinValidar, setTokenSinValidar] = useState(false);
  const [salida, setSalida] = useState<SalidaPendiente | null>(null);
  const verificando = useRef(false);
  const { online } = useEstadoConexion();

  const aplicarDecision = useCallback(async (
    decision: DecisionArranque<Usuario>,
    token: string,
    cfg: ConfigOffline | null,
    esArranque: boolean,
  ) => {
    // Si mientras se validaba el usuario salió o cambió de sesión, no se aplica un resultado viejo.
    if (getToken() !== token) return;
    switch (decision.accion) {
      case 'online': {
        setUsuario(decision.usuario);
        setSesionLocal(false);
        setTokenSinValidar(false);
        const previa = await leerSesionOffline();
        setOfflineActivo(resolverOfflineActivo(cfg?.activo, previa, decision.usuario.id));
        await recordarSesion(decision.usuario, token, cfg);
        return;
      }
      case 'offline': {
        if (!esArranque) return;
        setUsuario(decision.sesion.usuario);
        setSesionLocal(true);
        setOfflineActivo(decision.sesion.offlineActivo);
        setBloqueado(await pinOfflineConfigurado());
        return;
      }
      case 'cerrar': {
        // Solo el token y la sesión local: la cola y los borradores quedan protegidos para ese usuario.
        clearToken();
        await limpiarSesionOffline();
        await purgarCacheDeLectura();
        setUsuario(null);
        setSesionLocal(false);
        setBloqueado(false);
        setTokenSinValidar(false);
        setError(MENSAJE_SESION_CERRADA);
        return;
      }
      case 'sin-usuario': {
        // Token conservado: al volver la red se reintenta. No se borra nada.
        setTokenSinValidar(true);
        if (esArranque) setError(mensajeNoVigente(decision.motivo));
        return;
      }
    }
  }, []);

  /** Valida el token con el servidor y decide entre sesión online, sesión local o cierre. */
  const verificar = useCallback(async (esArranque: boolean) => {
    const token = getToken();
    if (!token || verificando.current) return;
    verificando.current = true;
    try {
      const local = await leerSesionOffline();
      const [me, cfg] = await Promise.all([
        pedirMe().then(
          (u) => ({ ok: true as const, usuario: u }),
          (err: unknown) => ({ ok: false as const, error: err }),
        ),
        pedirConfigOffline(),
      ]);
      const decision = decidirArranque(me, local, Date.now(), token);
      await aplicarDecision(decision, token, cfg, esArranque);
    } finally {
      verificando.current = false;
    }
  }, [aplicarDecision]);

  useEffect(() => {
    if (!getToken()) return;
    void verificar(true).finally(() => setCargando(false));
  }, [verificar]);

  // Al volver la red: revalida la sesión local (permisos, usuario desactivado) o reintenta el token sin validar.
  useEffect(() => {
    if (online && (sesionLocal || tokenSinValidar)) void verificar(false);
  }, [online, sesionLocal, tokenSinValidar, verificar]);

  const iniciarSesionLocalmente = (token: string, u: Usuario, remember: boolean) => {
    setToken(token, remember);
    setUsuario(u);
    setSesionLocal(false);
    setBloqueado(false);
    setTokenSinValidar(false);
    void pedirConfigOffline().then(async cfg => {
      // Sin respuesta del servidor solo se hereda el valor previo del MISMO usuario; si no, apagado.
      setOfflineActivo(resolverOfflineActivo(cfg?.activo, await leerSesionOffline(), u.id));
      await recordarSesion(u, token, cfg);
    });
  };

  const login = async (email: string, password: string, remember = true) => {
    setError(null);
    try {
      const { token, usuario: u } = await apiFetch<AuthResponse>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
        auth: false,
      });
      iniciarSesionLocalmente(token, mapUsuario(u), remember);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Error inesperado al iniciar sesión.';
      setError(msg);
      throw new Error(msg, { cause: err });
    }
  };

  const registro = async (email: string, password: string, nombre: string) => {
    setError(null);
    try {
      const { token, usuario: u } = await apiFetch<AuthResponse>('/api/auth/register', {
        method: 'POST',
        body: { email, password, nombre },
        auth: false,
      });
      iniciarSesionLocalmente(token, mapUsuario(u), true);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Error inesperado al registrarse.';
      setError(msg);
      throw new Error(msg, { cause: err });
    }
  };

  /** Cierra la sesión de verdad. La cola de pendientes nunca se toca; los borradores solo si se pide. */
  const salirDefinitivamente = async (borrarBorradores: boolean) => {
    clearToken();
    await limpiarSesionOffline();
    await purgarCacheDeLectura();
    if (borrarBorradores) borrarBorradoresLocales();
    limpiarUltimasRutas();
    setUsuario(null);
    setSesionLocal(false);
    setBloqueado(false);
    setTokenSinValidar(false);
  };

  /** El PIN se agotó: la sesión local ya se borró; se cierra la de red y se exige login en línea (cola y borradores intactos). */
  const alAgotarseElPin = () => {
    void salirDefinitivamente(false).then(() => setError(MENSAJE_PIN_AGOTADO));
  };

  const logout = async () => {
    let pendientes: number | null;
    let ajenas = 0;
    try {
      const conteo = await contarPendientesPorDueno();
      pendientes = conteo.propias + conteo.ajenas;
      ajenas = conteo.ajenas;
    } catch {
      pendientes = null;
    }
    const borradores = usuario ? contarBorradores(usuario.id) : 0;
    const plan = planificarSalida(pendientes, borradores, estaOnline(), ajenas);
    if (!plan.requiereConfirmacion) {
      await salirDefinitivamente(false);
      return;
    }
    await new Promise<void>(resolver => setSalida({ plan, pendientes, borradores, resolver }));
  };

  const cerrarDialogoSalida = () => {
    salida?.resolver();
    setSalida(null);
  };

  const confirmarSalida = async (borrarBorradores: boolean) => {
    await salirDefinitivamente(borrarBorradores);
    cerrarDialogoSalida();
  };

  const recargarUsuario = async () => {
    try {
      const u = await pedirMe();
      setUsuario(u);
      const token = getToken();
      if (token) await recordarSesion(u, token, null);
    } catch {
      // Un fallo transitorio no debe cerrar la sesión; se conserva el usuario actual.
    }
  };

  // Marca de color por usuario: se aplica al autenticar y se quita al salir o
  // cambiar de usuario. Mientras carga /me se conserva la marca recordada
  // (la pintó main.tsx antes del primer render) para no parpadear.
  const temaMarca = usuario?.temaMarca ?? null;
  useEffect(() => {
    if (cargando) return;
    aplicarTemaMarca(temaMarca);
  }, [temaMarca, cargando]);

  const tienePermisoFn = (recurso: Recurso, accion: Accion): boolean => {
    if (!usuario) return false;
    if (usuario.rol === 'superadmin') return true;
    return checkPermiso(usuario.permisos, recurso, accion);
  };

  const bloqueadoPorPin = bloqueado && usuario !== null;

  return (
    <AuthContext.Provider value={{ usuario, cargando, error, sesionLocal, offlineActivo, login, registro, logout, recargarUsuario, tienePermiso: tienePermisoFn }}>
      {bloqueadoPorPin
        ? <PantallaDesbloqueoPin usuario={usuario} onDesbloqueado={() => setBloqueado(false)} onCerrarSesion={logout} onAgotado={alAgotarseElPin} />
        : children}
      {salida && (
        <ConfirmarSalidaModal
          plan={salida.plan}
          onCancelar={cerrarDialogoSalida}
          onSalir={confirmarSalida}
          onExportar={exportarCola}
        />
      )}
    </AuthContext.Provider>
  );
}
