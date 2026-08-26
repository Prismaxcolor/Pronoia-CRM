import { describe, it, expect } from 'vitest';
import { PERMISOS_POR_ROL, RECURSOS, tienePermiso } from '../src/utils/permisos.js';
import { PERMISOS_POR_ROL as PERMISOS_POR_ROL_FRONTEND, RECURSOS as RECURSOS_FRONTEND } from '../../shared/types/usuario.js';

describe('tienePermiso', () => {
  const permisos = PERMISOS_POR_ROL.administracion;

  it('devuelve true para un permiso presente', () => {
    expect(tienePermiso(permisos, 'clientes', 'ver')).toBe(true);
  });

  it('devuelve false para un permiso ausente', () => {
    expect(tienePermiso(permisos, 'usuarios', 'crear')).toBe(false);
  });
});

describe('matriz de permisos por rol', () => {
  it('el trabajador puede registrar pesajes', () => {
    expect(tienePermiso(PERMISOS_POR_ROL.trabajador, 'pesaje', 'crear')).toBe(true);
  });

  it('el trabajador NO tiene facturación', () => {
    expect(tienePermiso(PERMISOS_POR_ROL.trabajador, 'facturacion', 'ver')).toBe(false);
  });

  it('administración gestiona proveedores pero no los borra', () => {
    expect(tienePermiso(PERMISOS_POR_ROL.administracion, 'proveedores', 'crear')).toBe(true);
    expect(tienePermiso(PERMISOS_POR_ROL.administracion, 'proveedores', 'eliminar')).toBe(false);
  });

  it('superadmin tiene todos los recursos definidos', () => {
    for (const r of RECURSOS) {
      expect(tienePermiso(PERMISOS_POR_ROL.superadmin, r, 'ver')).toBe(true);
    }
  });

  it('solo superadmin puede eliminar tickets de pesaje', () => {
    expect(tienePermiso(PERMISOS_POR_ROL.superadmin, 'pesaje', 'eliminar')).toBe(true);
    expect(tienePermiso(PERMISOS_POR_ROL.administracion, 'pesaje', 'eliminar')).toBe(false);
    expect(tienePermiso(PERMISOS_POR_ROL.trabajador, 'pesaje', 'eliminar')).toBe(false);
  });
});

// La matriz de permisos vive duplicada entre este archivo (backend/src/utils/permisos.ts)
// y shared/types/usuario.ts (el alias @shared no resuelve en runtime con tsx+ESM, ver
// comentario en permisos.ts) — este test es la única red de seguridad contra que las dos
// copias se desincronicen otra vez, que fue justo la causa del "error grandísimo" al
// guardar permisos personalizados (schemas/usuarios.ts tenía una tercera lista, vieja,
// con 8 de los 15 recursos).
describe('paridad entre backend/utils/permisos.ts y shared/types/usuario.ts', () => {
  it('RECURSOS es idéntico en ambas copias', () => {
    expect([...RECURSOS_FRONTEND]).toEqual([...RECURSOS]);
  });

  it('PERMISOS_POR_ROL es idéntico en ambas copias para cada rol', () => {
    for (const rol of Object.keys(PERMISOS_POR_ROL) as Array<keyof typeof PERMISOS_POR_ROL>) {
      const claves = (arr: { recurso: string; accion: string }[]) =>
        new Set(arr.map(p => `${p.recurso}:${p.accion}`));
      expect(claves(PERMISOS_POR_ROL_FRONTEND[rol])).toEqual(claves(PERMISOS_POR_ROL[rol]));
    }
  });
});
