import { describe, it, expect } from 'vitest';
import { redondearKg as redondearShared, calcularDiferenciaPeso as calcShared } from '../../shared/types/ticket-pesaje.js';
import { redondearKg, calcularDiferenciaPeso } from '../src/utils/peso-kg.js';

describe('redondearKg', () => {
  it('elimina el ruido de punto flotante de tara x cantidad', () => {
    expect(redondearKg(0.2 * 3)).toBe(0.6);
    expect(redondearKg(0.6000000000000001)).toBe(0.6);
    expect(redondearKg(68.6 - 0.6000000000000001)).toBe(68);
  });
  it('redondea a 3 decimales', () => {
    expect(redondearKg(1.23456)).toBe(1.235);
  });
  it('no devuelve -0', () => {
    expect(Object.is(redondearKg(-0.0001), 0)).toBe(true);
  });
});

describe('calcularDiferenciaPeso', () => {
  it('global - neto - devolucion', () => {
    expect(calcularDiferenciaPeso({ pesoGlobal: 157.2, netoMateriales: 153.28, devolucion: 2.4 })).toBe(1.52);
  });
  it('0.1 + 0.2 no deja residuo', () => {
    expect(calcularDiferenciaPeso({ pesoGlobal: 0.3, netoMateriales: 0.1 + 0.2, devolucion: 0 })).toBe(0);
  });
  it('negativo cuando los materiales superan el global', () => {
    expect(calcularDiferenciaPeso({ pesoGlobal: 10, netoMateriales: 10.5, devolucion: 0 })).toBe(-0.5);
  });
});

describe('paridad frontend (shared) / backend', () => {
  const casos = [0, 0.1 + 0.2, 1.0005, 123.4567, -0.0004, 978.5999999999999, 0.6000000000000001];
  it('redondearKg coincide', () => {
    for (const n of casos) expect(redondearKg(n)).toBe(redondearShared(n));
  });
  it('calcularDiferenciaPeso coincide', () => {
    for (const a of casos) for (const b of casos) {
      const e = { pesoGlobal: a, netoMateriales: b, devolucion: 0.1 };
      expect(calcularDiferenciaPeso(e)).toBe(calcShared(e));
    }
  });
});
