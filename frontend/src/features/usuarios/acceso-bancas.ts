import type { RolUsuario } from '@shared/types/index.js';

/** Roles que ven todas las cuentas/cajas sin asignación (misma regla que el backend, utils/banca-acceso.ts). */
export const ROLES_CON_TODAS_LAS_BANCAS: readonly RolUsuario[] = ['superadmin'];
