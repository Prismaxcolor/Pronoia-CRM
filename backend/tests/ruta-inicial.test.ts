import { describe, it, expect } from 'vitest';
import { elegirRutaInicial, ORDEN_RUTA_INICIAL } from '../../frontend/src/lib/ruta-inicial';
import { PERMISOS_POR_ROL, tienePermiso } from '../../shared/types/usuario';
import type { Permiso, Recurso, Accion } from '../../shared/types/usuario';

const conPermisos = (permisos: Permiso[]) => (r: Recurso, a: Accion) => tienePermiso(permisos, r, a);
const solo = (...recursos: Recurso[]) => conPermisos(recursos.map(recurso => ({ recurso, accion: 'ver' as const })));

describe('elegirRutaInicial', () => {
  it('devuelve null cuando el usuario tiene dashboard:ver', () => {
    expect(elegirRutaInicial(solo('dashboard', 'pesaje'))).toBeNull();
  });

  it('manda al trabajador por defecto a Pesaje', () => {
    expect(elegirRutaInicial(conPermisos(PERMISOS_POR_ROL.trabajador))).toBe('/pesaje');
  });

  it('respeta el orden de preferencia', () => {
    expect(elegirRutaInicial(solo('cochinito', 'proveedores', 'transformaciones'))).toBe('/transformaciones');
    expect(elegirRutaInicial(solo('cochinito', 'proveedores'))).toBe('/proveedores');
    expect(elegirRutaInicial(solo('facturacion', 'productos'))).toBe('/inventario');
  });

  it('devuelve null si no tiene ninguna pantalla permitida', () => {
    expect(elegirRutaInicial(() => false)).toBeNull();
    expect(elegirRutaInicial(solo('toma_fisica', 'categorias'))).toBeNull();
  });

  it('exige la acción ver, no otras acciones', () => {
    const soloCrear = conPermisos([{ recurso: 'pesaje', accion: 'crear' }]);
    expect(elegirRutaInicial(soloCrear)).toBeNull();
  });

  it('nunca apunta a "/" (evita bucles de redirección)', () => {
    expect(ORDEN_RUTA_INICIAL.every(p => p.ruta !== '/')).toBe(true);
  });
});
