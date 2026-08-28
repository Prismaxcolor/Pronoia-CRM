/**
 * Matriz de permisos del sistema. Espejo del archivo
 * shared/types/usuario.ts del frontend; se duplica intencionalmente
 * (CLAUDE.md permite duplicar tipos compartidos cuando hace falta)
 * porque el alias @shared no se resuelve cleanly en runtime con tsx
 * + ESM + extensiones .js.
 *
 * Si se actualiza shared/types/usuario.ts, actualizar también este archivo.
 */

export const ROLES = ['superadmin', 'administracion', 'trabajador'] as const;
export type RolUsuario = (typeof ROLES)[number];

/** Única fuente de verdad en runtime para qué páginas existen — de acá se
 *  derivan tanto el tipo Recurso como el enum de validación de
 *  schemas/usuarios.ts. Antes había una tercera lista hardcodeada en el
 *  schema que quedó vieja (le faltaban 7 recursos) y tiraba "Datos
 *  inválidos" al guardar permisos personalizados que los tocaran — con esto
 *  ya no puede volver a desincronizarse dentro del backend. */
export const RECURSOS = [
  'dashboard',
  'productos',
  'categorias',
  'taras',
  'almacenes',
  'listas_precios',
  'cochinito',
  'facturacion',
  'usuarios',
  'clientes',
  'proveedores',
  'pesaje',
  'traslados',
  'transformaciones',
  'despachos',
  'toma_fisica',
] as const;
export type Recurso = (typeof RECURSOS)[number];

export const ACCIONES = ['ver', 'crear', 'editar', 'eliminar'] as const;
export type Accion = (typeof ACCIONES)[number];

export interface Permiso {
  recurso: Recurso;
  accion: Accion;
}

export const PERMISOS_POR_ROL: Record<RolUsuario, Permiso[]> = {
  superadmin: [
    { recurso: 'dashboard', accion: 'ver' },
    { recurso: 'productos', accion: 'ver' }, { recurso: 'productos', accion: 'crear' }, { recurso: 'productos', accion: 'editar' }, { recurso: 'productos', accion: 'eliminar' },
    { recurso: 'categorias', accion: 'ver' }, { recurso: 'categorias', accion: 'crear' }, { recurso: 'categorias', accion: 'editar' }, { recurso: 'categorias', accion: 'eliminar' },
    { recurso: 'taras', accion: 'ver' }, { recurso: 'taras', accion: 'crear' }, { recurso: 'taras', accion: 'editar' }, { recurso: 'taras', accion: 'eliminar' },
    { recurso: 'almacenes', accion: 'ver' }, { recurso: 'almacenes', accion: 'crear' }, { recurso: 'almacenes', accion: 'editar' }, { recurso: 'almacenes', accion: 'eliminar' },
    { recurso: 'listas_precios', accion: 'ver' }, { recurso: 'listas_precios', accion: 'crear' }, { recurso: 'listas_precios', accion: 'editar' }, { recurso: 'listas_precios', accion: 'eliminar' },
    { recurso: 'facturacion', accion: 'ver' }, { recurso: 'facturacion', accion: 'crear' }, { recurso: 'facturacion', accion: 'editar' },
    { recurso: 'cochinito', accion: 'ver' }, { recurso: 'cochinito', accion: 'crear' }, { recurso: 'cochinito', accion: 'editar' }, { recurso: 'cochinito', accion: 'eliminar' },
    { recurso: 'usuarios', accion: 'ver' }, { recurso: 'usuarios', accion: 'crear' }, { recurso: 'usuarios', accion: 'editar' }, { recurso: 'usuarios', accion: 'eliminar' },
    { recurso: 'clientes', accion: 'ver' }, { recurso: 'clientes', accion: 'crear' }, { recurso: 'clientes', accion: 'editar' }, { recurso: 'clientes', accion: 'eliminar' },
    { recurso: 'proveedores', accion: 'ver' }, { recurso: 'proveedores', accion: 'crear' }, { recurso: 'proveedores', accion: 'editar' }, { recurso: 'proveedores', accion: 'eliminar' },
    { recurso: 'pesaje', accion: 'ver' }, { recurso: 'pesaje', accion: 'crear' }, { recurso: 'pesaje', accion: 'editar' }, { recurso: 'pesaje', accion: 'eliminar' },
    { recurso: 'traslados', accion: 'ver' }, { recurso: 'traslados', accion: 'crear' }, { recurso: 'traslados', accion: 'editar' }, { recurso: 'traslados', accion: 'eliminar' },
    { recurso: 'transformaciones', accion: 'ver' }, { recurso: 'transformaciones', accion: 'crear' }, { recurso: 'transformaciones', accion: 'editar' }, { recurso: 'transformaciones', accion: 'eliminar' },
    { recurso: 'despachos', accion: 'ver' }, { recurso: 'despachos', accion: 'crear' }, { recurso: 'despachos', accion: 'editar' }, { recurso: 'despachos', accion: 'eliminar' },
    { recurso: 'toma_fisica', accion: 'ver' }, { recurso: 'toma_fisica', accion: 'crear' }, { recurso: 'toma_fisica', accion: 'editar' }, { recurso: 'toma_fisica', accion: 'eliminar' },
  ],
  administracion: [
    { recurso: 'dashboard', accion: 'ver' },
    { recurso: 'productos', accion: 'ver' },
    { recurso: 'categorias', accion: 'ver' },
    { recurso: 'taras', accion: 'ver' },
    { recurso: 'almacenes', accion: 'ver' },
    { recurso: 'listas_precios', accion: 'ver' },
    { recurso: 'facturacion', accion: 'ver' }, { recurso: 'facturacion', accion: 'crear' }, { recurso: 'facturacion', accion: 'editar' },
    { recurso: 'cochinito', accion: 'ver' }, { recurso: 'cochinito', accion: 'crear' }, { recurso: 'cochinito', accion: 'editar' },
    { recurso: 'clientes', accion: 'ver' }, { recurso: 'clientes', accion: 'crear' }, { recurso: 'clientes', accion: 'editar' },
    { recurso: 'proveedores', accion: 'ver' }, { recurso: 'proveedores', accion: 'crear' }, { recurso: 'proveedores', accion: 'editar' },
    { recurso: 'pesaje', accion: 'ver' }, { recurso: 'pesaje', accion: 'crear' }, { recurso: 'pesaje', accion: 'editar' },
    { recurso: 'traslados', accion: 'ver' }, { recurso: 'traslados', accion: 'crear' }, { recurso: 'traslados', accion: 'editar' },
    { recurso: 'transformaciones', accion: 'ver' },
    { recurso: 'despachos', accion: 'ver' }, { recurso: 'despachos', accion: 'crear' }, { recurso: 'despachos', accion: 'editar' },
    { recurso: 'toma_fisica', accion: 'ver' }, { recurso: 'toma_fisica', accion: 'crear' }, { recurso: 'toma_fisica', accion: 'editar' },
  ],
  trabajador: [
    { recurso: 'productos', accion: 'ver' }, { recurso: 'productos', accion: 'crear' }, { recurso: 'productos', accion: 'editar' },
    { recurso: 'categorias', accion: 'ver' }, { recurso: 'categorias', accion: 'crear' }, { recurso: 'categorias', accion: 'editar' },
    { recurso: 'taras', accion: 'ver' }, { recurso: 'taras', accion: 'crear' }, { recurso: 'taras', accion: 'editar' },
    { recurso: 'almacenes', accion: 'ver' }, { recurso: 'almacenes', accion: 'crear' }, { recurso: 'almacenes', accion: 'editar' },
    { recurso: 'listas_precios', accion: 'ver' }, { recurso: 'listas_precios', accion: 'crear' }, { recurso: 'listas_precios', accion: 'editar' },
    { recurso: 'clientes', accion: 'ver' },
    { recurso: 'proveedores', accion: 'ver' },
    { recurso: 'pesaje', accion: 'ver' }, { recurso: 'pesaje', accion: 'crear' },
    { recurso: 'traslados', accion: 'ver' }, { recurso: 'traslados', accion: 'crear' },
    { recurso: 'transformaciones', accion: 'ver' }, { recurso: 'transformaciones', accion: 'crear' },
    { recurso: 'despachos', accion: 'ver' },
    { recurso: 'toma_fisica', accion: 'ver' }, { recurso: 'toma_fisica', accion: 'crear' },
  ],
};

export function tienePermiso(permisos: Permiso[], recurso: Recurso, accion: Accion): boolean {
  return permisos.some(p => p.recurso === recurso && p.accion === accion);
}
