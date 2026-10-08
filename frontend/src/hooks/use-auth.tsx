import { useEffect, useState, type ReactNode } from 'react';
import { apiFetch, setToken, clearToken, getToken, ApiError } from '../services/api-client';
import { limpiarUltimasRutas } from '../services/nav-memory';
import { aplicarTemaMarca, normalizarTemaMarca } from '../lib/tema-marca';
import { PERMISOS_POR_ROL, tienePermiso as checkPermiso } from '@shared/types/index.js';
import type { Usuario, Permiso, Recurso, Accion } from '@shared/types/index.js';
import { AuthContext } from './use-auth-context';

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  // Sin token no hay nada que cargar — se resuelve en el estado inicial (el
  // token ya está disponible de forma síncrona vía localStorage) en vez de
  // vía setState síncrono dentro del efecto.
  const [cargando, setCargando] = useState(() => !!getToken());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    apiFetch<{ usuario: UsuarioApi }>('/api/auth/me')
      .then(({ usuario: u }) => setUsuario(mapUsuario(u)))
      // Sesión vencida o inválida: clearToken también borra los borradores de formularios.
      .catch(() => clearToken())
      .finally(() => setCargando(false));
  }, []);

  const login = async (email: string, password: string, remember = true) => {
    setError(null);
    try {
      const { token, usuario: u } = await apiFetch<AuthResponse>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
        auth: false,
      });
      setToken(token, remember);
      setUsuario(mapUsuario(u));
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
      setToken(token);
      setUsuario(mapUsuario(u));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Error inesperado al registrarse.';
      setError(msg);
      throw new Error(msg, { cause: err });
    }
  };

  const logout = async () => {
    // clearToken también borra los borradores de formularios: son del usuario que sale.
    clearToken();
    limpiarUltimasRutas();
    setUsuario(null);
  };

  const recargarUsuario = async () => {
    try {
      const { usuario: u } = await apiFetch<{ usuario: UsuarioApi }>('/api/auth/me');
      setUsuario(mapUsuario(u));
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

  return (
    <AuthContext.Provider value={{ usuario, cargando, error, login, registro, logout, recargarUsuario, tienePermiso: tienePermisoFn }}>
      {children}
    </AuthContext.Provider>
  );
}
