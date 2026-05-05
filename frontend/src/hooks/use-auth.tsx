import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../config/supabase';
import { PERMISOS_POR_ROL, tienePermiso as checkPermiso } from '@shared/types/index.js';
import type { Usuario, Permiso, Recurso, Accion } from '@shared/types/index.js';
import type { AuthContextType } from '../types/auth';

const AuthContext = createContext<AuthContextType | null>(null);

const SESSION_KEY = 'pronoia_session';

function mapUser(row: Record<string, unknown>): Usuario {
  const rol = row.rol as Usuario['rol'];
  const permisosCustom = row.permisos as Permiso[] | null;
  const permisos = permisosCustom && permisosCustom.length > 0
    ? permisosCustom
    : PERMISOS_POR_ROL[rol] ?? [];

  return {
    id: row.id as string,
    authId: row.id as string,
    nombre: row.nombre as string,
    email: row.email as string,
    rol,
    permisos,
    activo: row.activo as boolean,
    creadoEn: row.creado_en as string,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Restaurar sesión al cargar
  useEffect(() => {
    const savedId = localStorage.getItem(SESSION_KEY);
    if (savedId) {
      supabase.from('users').select('*').eq('id', savedId).single()
        .then(({ data }) => {
          if (data) setUsuario(mapUser(data));
          setCargando(false);
        });
    } else {
      setCargando(false);
    }
  }, []);

  const login = async (email: string, password: string) => {
    setError(null);

    const { data, error: err } = await supabase.rpc('verify_login', {
      p_email: email,
      p_password: password,
    });

    if (err || !data || data.length === 0) {
      const msg = 'Email o contrasena incorrectos';
      setError(msg);
      throw new Error(msg);
    }

    const user = mapUser(data[0]);
    localStorage.setItem(SESSION_KEY, user.id);
    setUsuario(user);
  };

  const registro = async (email: string, password: string, nombre: string) => {
    setError(null);

    // Verificar si el email ya existe
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existing) {
      const msg = 'Ya existe una cuenta con ese email';
      setError(msg);
      throw new Error(msg);
    }

    const { data, error: err } = await supabase.rpc('create_user', {
      p_email: email,
      p_password: password,
      p_nombre: nombre,
    });

    if (err || !data || data.length === 0) {
      const msg = 'Error al crear la cuenta';
      setError(msg);
      throw new Error(msg);
    }

    const user = mapUser(data[0]);
    localStorage.setItem(SESSION_KEY, user.id);
    setUsuario(user);
  };

  const logout = async () => {
    localStorage.removeItem(SESSION_KEY);
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
