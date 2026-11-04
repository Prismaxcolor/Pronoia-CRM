import { describe, it, expect } from 'vitest';
import { apilar, desapilar, esSuperior, accionScroll, destinoTab } from '../../frontend/src/lib/pila-modales';

describe('pila de modales', () => {
  it('apilar agrega al final sin duplicar y sin mutar', () => {
    const base = ['a'] as const;
    const con = apilar(base, 'b');
    expect(con).toEqual(['a', 'b']);
    expect(base).toEqual(['a']);
    expect(apilar(con, 'b')).toBe(con);
  });
  it('desapilar quita solo ese id (también si no es el de arriba)', () => {
    expect(desapilar(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
    expect(desapilar(['a'], 'x')).toEqual(['a']);
  });
  it('solo el modal superior reacciona a Escape', () => {
    const pila = ['padre', 'hoja'];
    expect(esSuperior(pila, 'hoja')).toBe(true);
    expect(esSuperior(pila, 'padre')).toBe(false);
    expect(esSuperior([], 'x')).toBe(false);
  });
  it('al cerrar la hoja el padre vuelve a ser el superior', () => {
    expect(esSuperior(desapilar(['padre', 'hoja'], 'hoja'), 'padre')).toBe(true);
  });
});

describe('accionScroll (contador de bloqueo)', () => {
  it('bloquea al abrir el primero y libera al cerrar el último', () => {
    expect(accionScroll(0, 1)).toBe('bloquear');
    expect(accionScroll(1, 0)).toBe('liberar');
  });
  it('con modales anidados no cambia nada hasta que se cierra el último', () => {
    expect(accionScroll(1, 2)).toBeNull();
    expect(accionScroll(2, 1)).toBeNull();
    expect(accionScroll(0, 0)).toBeNull();
  });
});

describe('destinoTab (trampa de foco)', () => {
  it('Tab en el último vuelve al primero; Shift+Tab en el primero va al último', () => {
    expect(destinoTab(3, 2, false)).toBe(0);
    expect(destinoTab(3, 0, true)).toBe(2);
  });
  it('en el medio deja el orden normal', () => {
    expect(destinoTab(3, 1, false)).toBeNull();
    expect(destinoTab(3, 1, true)).toBeNull();
  });
  it('con el foco fuera del modal entra por el primero (Tab) o el último (Shift+Tab)', () => {
    expect(destinoTab(3, -1, false)).toBe(0);
    expect(destinoTab(3, -1, true)).toBe(2);
  });
  it('sin enfocables no decide nada', () => {
    expect(destinoTab(0, -1, false)).toBeNull();
  });
  it('un solo enfocable: Tab y Shift+Tab se quedan en él', () => {
    expect(destinoTab(1, 0, false)).toBe(0);
    expect(destinoTab(1, 0, true)).toBe(0);
  });
});
