import { describe, it, expect } from 'vitest';
import { nuevoUuid, resolverIntento, huellaDe } from '../../frontend/src/lib/intento-envio';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('nuevoUuid', () => {
  it('genera uuid v4 distintos', () => {
    const a = nuevoUuid();
    expect(a).toMatch(UUID_V4);
    expect(nuevoUuid()).not.toBe(a);
  });

  it('sin crypto.randomUUID usa getRandomValues y mantiene el formato v4', () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues: original.getRandomValues.bind(original) }, configurable: true });
    try { expect(nuevoUuid()).toMatch(UUID_V4); } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
    }
  });

  it('sin crypto alguno cae a Math.random y mantiene el formato v4', () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try { expect(nuevoUuid()).toMatch(UUID_V4); } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
    }
  });
});

describe('resolverIntento', () => {
  it('con los mismos datos reutiliza la clave (doble clic, reintento tras error de red)', () => {
    let n = 0;
    const generar = () => `id-${++n}`;
    const primero = resolverIntento(null, 'datos-A', generar);
    const reintento = resolverIntento(primero, 'datos-A', generar);
    expect(reintento.id).toBe(primero.id);
    expect(n).toBe(1);
  });

  it('si el usuario cambia los datos abre una clave nueva', () => {
    let n = 0;
    const generar = () => `id-${++n}`;
    const primero = resolverIntento(null, 'datos-A', generar);
    expect(resolverIntento(primero, 'datos-B', generar).id).toBe('id-2');
  });
});

describe('huellaDe', () => {
  it('no depende del orden de los campos', () => {
    expect(huellaDe({ a: 1, b: { x: 1, y: 2 } })).toBe(huellaDe({ b: { y: 2, x: 1 }, a: 1 }));
  });

  it('cambia si cambia cualquier valor, incluido dentro de listas', () => {
    expect(huellaDe({ items: [{ id: 'f1', monto: 10 }] })).not.toBe(huellaDe({ items: [{ id: 'f1', monto: 11 }] }));
  });
});
