/**
 * Matriz de permisos del sistema. Espejo del archivo
 * shared/types/usuario.ts del frontend; se duplica intencionalmente
 * (CLAUDE.md permite duplicar tipos compartidos cuando hace falta)
 * porque el alias @shared no se resuelve cleanly en runtime con tsx
 * + ESM + extensiones .js.
 *
 * Si se actualiza shared/types/usuario.ts, actualizar también este archivo.
 */

export type RolUsuario = 'superadmin' | 'administracion' | 'trabajador';
export type Recurso = 'dashboard' | 'productos' | 'cochinito' | 'facturacion' | 'usuarios' | 'clientes' | 'proveedores' | 'pesaje';
export type Accion = 'ver' | 'crear' | 'editar' | 'eliminar';

export interface Permiso {
  recurso: Recurso;
  accion: Accion;
}

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
