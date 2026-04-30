export type RolUsuario = 'admin' | 'tesorero' | 'operador';

export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  rol: RolUsuario;
  activo: boolean;
}
