import type { Usuario, Recurso, Accion } from '@shared/types/index.js';

export interface AuthState {
  usuario: Usuario | null;
  cargando: boolean;
  error: string | null;
  /** true si se está usando la sesión guardada en el equipo (sin haber podido validar con el servidor). */
  sesionLocal: boolean;
  /** Interruptor del servidor (OFFLINE_ACTIVO) para este usuario; false = comportamiento de siempre. */
  offlineActivo: boolean;
}

export interface AuthContextType extends AuthState {
  login: (email: string, password: string, remember?: boolean) => Promise<void>;
  registro: (email: string, password: string, nombre: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Relee /api/auth/me (p. ej. tras enlazar Telegram). */
  recargarUsuario: () => Promise<void>;
  tienePermiso: (recurso: Recurso, accion: Accion) => boolean;
}
