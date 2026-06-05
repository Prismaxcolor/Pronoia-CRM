export type RolUsuario = 'superadmin' | 'administracion' | 'trabajador';

export interface Usuario {
  id: string;
  authId: string;
  nombre: string;
  email: string;
  rol: RolUsuario;
  permisos: Permiso[];
  activo: boolean;
  creadoEn: string;
}

export type Recurso = 'dashboard' | 'productos' | 'cochinito' | 'facturacion' | 'usuarios' | 'clientes' | 'proveedores' | 'pesaje';
export type Accion = 'ver' | 'crear' | 'editar' | 'eliminar';

export interface Permiso {
  recurso: Recurso;
  accion: Accion;
}

/** Permisos por defecto de cada rol */
export const PERMISOS_POR_ROL: Record<RolUsuario, Permiso[]> = {
  superadmin: [
    { recurso: 'dashboard', accion: 'ver' },
    { recurso: 'productos', accion: 'ver' }, { recurso: 'productos', accion: 'crear' }, { recurso: 'productos', accion: 'editar' }, { recurso: 'productos', accion: 'eliminar' },
    { recurso: 'facturacion', accion: 'ver' }, { recurso: 'facturacion', accion: 'crear' }, { recurso: 'facturacion', accion: 'editar' },
    { recurso: 'cochinito', accion: 'ver' }, { recurso: 'cochinito', accion: 'crear' }, { recurso: 'cochinito', accion: 'editar' }, { recurso: 'cochinito', accion: 'eliminar' },
    { recurso: 'usuarios', accion: 'ver' }, { recurso: 'usuarios', accion: 'crear' }, { recurso: 'usuarios', accion: 'editar' }, { recurso: 'usuarios', accion: 'eliminar' },
    { recurso: 'clientes', accion: 'ver' }, { recurso: 'clientes', accion: 'crear' }, { recurso: 'clientes', accion: 'editar' }, { recurso: 'clientes', accion: 'eliminar' },
    { recurso: 'proveedores', accion: 'ver' }, { recurso: 'proveedores', accion: 'crear' }, { recurso: 'proveedores', accion: 'editar' }, { recurso: 'proveedores', accion: 'eliminar' },
    { recurso: 'pesaje', accion: 'ver' }, { recurso: 'pesaje', accion: 'crear' }, { recurso: 'pesaje', accion: 'editar' },
  ],
  administracion: [
    { recurso: 'dashboard', accion: 'ver' },
    { recurso: 'productos', accion: 'ver' },
    { recurso: 'facturacion', accion: 'ver' }, { recurso: 'facturacion', accion: 'crear' }, { recurso: 'facturacion', accion: 'editar' },
    { recurso: 'cochinito', accion: 'ver' }, { recurso: 'cochinito', accion: 'crear' }, { recurso: 'cochinito', accion: 'editar' },
    { recurso: 'clientes', accion: 'ver' }, { recurso: 'clientes', accion: 'crear' }, { recurso: 'clientes', accion: 'editar' },
    { recurso: 'proveedores', accion: 'ver' }, { recurso: 'proveedores', accion: 'crear' }, { recurso: 'proveedores', accion: 'editar' },
    { recurso: 'pesaje', accion: 'ver' }, { recurso: 'pesaje', accion: 'crear' },
  ],
  trabajador: [
    { recurso: 'productos', accion: 'ver' }, { recurso: 'productos', accion: 'crear' }, { recurso: 'productos', accion: 'editar' },
    { recurso: 'clientes', accion: 'ver' },
    { recurso: 'proveedores', accion: 'ver' },
    { recurso: 'pesaje', accion: 'ver' }, { recurso: 'pesaje', accion: 'crear' },
  ],
};

export function tienePermiso(permisos: Permiso[], recurso: Recurso, accion: Accion): boolean {
  return permisos.some(p => p.recurso === recurso && p.accion === accion);
}
