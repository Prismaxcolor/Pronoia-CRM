import { describe, it, expect } from 'vitest';
import { PERMISOS_POR_ROL, tienePermiso } from '../src/utils/permisos.js';

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
    const recursos = ['dashboard', 'productos', 'cochinito', 'facturacion', 'usuarios', 'clientes', 'proveedores', 'pesaje'] as const;
    for (const r of recursos) {
      expect(tienePermiso(PERMISOS_POR_ROL.superadmin, r, 'ver')).toBe(true);
    }
  });
});
