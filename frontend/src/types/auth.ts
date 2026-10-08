import type { Usuario, Recurso, Accion } from '@shared/types/index.js';

export interface AuthState {
  usuario: Usuario | null;
  cargando: boolean;
  error: string | null;
}

export interface AuthContextType extends AuthState {
  login: (email: string, password: string, remember?: boolean) => Promise<void>;
  registro: (email: string, password: string, nombre: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Relee /api/auth/me (p. ej. tras enlazar Telegram). */
  recargarUsuario: () => Promise<void>;
  tienePermiso: (recurso: Recurso, accion: Accion) => boolean;
}
