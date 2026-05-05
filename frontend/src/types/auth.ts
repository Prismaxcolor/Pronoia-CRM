import type { Usuario, Permiso, Recurso, Accion } from '@shared/types/index.js';

export interface AuthState {
  usuario: Usuario | null;
  cargando: boolean;
  error: string | null;
}

export interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  registro: (email: string, password: string, nombre: string) => Promise<void>;
  logout: () => Promise<void>;
  tienePermiso: (recurso: Recurso, accion: Accion) => boolean;
}
