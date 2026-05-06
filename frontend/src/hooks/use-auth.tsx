import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch, setToken, clearToken, getToken, ApiError } from '../services/api-client';
import { PERMISOS_POR_ROL, tienePermiso as checkPermiso } from '@shared/types/index.js';
import type { Usuario, Permiso, Recurso, Accion } from '@shared/types/index.js';
import type { AuthContextType } from '../types/auth';

const AuthContext = createContext<AuthContextType | null>(null);

interface UsuarioApi {
  id: string;
  email: string;
  nombre: string;
  rol: Usuario['rol'];
  permisos: Permiso[] | null;
  activo: boolean;
  creadoEn: string;
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
  };
}

interface AuthResponse {
  token: string;
  usuario: UsuarioApi;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setCargando(false);
      return;
    }

    apiFetch<{ usuario: UsuarioApi }>('/api/auth/me')
      .then(({ usuario: u }) => setUsuario(mapUsuario(u)))
      .catch(() => clearToken())
      .finally(() => setCargando(false));
  }, []);

  const login = async (email: string, password: string) => {
    setError(null);
    try {
      const { token, usuario: u } = await apiFetch<AuthResponse>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
        auth: false,
      });
      setToken(token);
      setUsuario(mapUsuario(u));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Error inesperado al iniciar sesión.';
      setError(msg);
      throw new Error(msg);
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
      throw new Error(msg);
    }
  };

  const logout = async () => {
    clearToken();
    setUsuario(null);
  };

  const tienePermisoFn = (recurso: Recurso, accion: Accion): boolean => {
    if (!usuario) return false;
    if (usuario.rol === 'superadmin') return true;
    return checkPermiso(usuario.permisos, recurso, accion);
  };

  return (
    <AuthContext.Provider value={{ usuario, cargando, error, login, registro, logout, tienePermiso: tienePermisoFn }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
