import type { Banca, RolUsuario } from '@shared/types/index.js';

/** Roles que ven y editan todas las cuentas/cajas sin asignación (misma regla que el backend, utils/banca-acceso.ts). */
export const ROLES_CON_TODAS_LAS_BANCAS: readonly RolUsuario[] = ['superadmin'];

/** Cuentas a las que un usuario accede: `ver` = consulta; `editar` (subconjunto de ver) = además registra/modifica. */
export interface AccesoBancasUsuario {
  ver: readonly string[];
  editar: readonly string[];
}

/** Sin información de edición (backend anterior a la migración) se asume editable, como antes. */
export function puedeEditarBanca(banca: Pick<Banca, 'puedeEditar'>): boolean {
  return banca.puedeEditar !== false;
}

/** Cuentas donde se puede registrar/modificar dinero: las que el selector de un registro debe ofrecer. */
export function bancasEditables<T extends Pick<Banca, 'puedeEditar'>>(bancas: readonly T[]): T[] {
  return bancas.filter(puedeEditarBanca);
}

/** Marca o desmarca "ver". Quitar la vista quita también la edición (editar implica ver). */
export function alternarVer(acceso: AccesoBancasUsuario, id: string): AccesoBancasUsuario {
  if (acceso.ver.includes(id)) {
    return { ver: acceso.ver.filter(x => x !== id), editar: acceso.editar.filter(x => x !== id) };
  }
  return { ver: [...acceso.ver, id], editar: acceso.editar };
}

/** Marca o desmarca "editar". Dar edición da también la vista. */
export function alternarEditar(acceso: AccesoBancasUsuario, id: string): AccesoBancasUsuario {
  if (acceso.editar.includes(id)) return { ver: acceso.ver, editar: acceso.editar.filter(x => x !== id) };
  return { ver: acceso.ver.includes(id) ? acceso.ver : [...acceso.ver, id], editar: [...acceso.editar, id] };
}

/** Acceso completo (ver y editar) a todas las cuentas dadas, o ninguno si la lista va vacía. */
export function accesoATodas(ids: readonly string[]): AccesoBancasUsuario {
  return { ver: [...ids], editar: [...ids] };
}
