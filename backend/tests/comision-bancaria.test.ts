import { describe, it, expect } from 'vitest';
import * as compartido from '../../shared/types/comision-bancaria.js';
import * as backend from '../src/utils/comision-bancaria.js';

/** Las dos copias (shared para el formulario, utils para el servidor) deben dar siempre lo mismo. */
describe.each([
  ['shared', compartido],
  ['backend', backend],
])('comisión bancaria (%s)', (_nombre, m) => {
  it('usa las constantes del cliente: 0.3% con mínimo de 14 Bs', () => {
    expect(m.TASA_COMISION_BANCARIA).toBe(0.003);
    expect(m.MINIMO_COMISION_BANCARIA_BS).toBe(14);
  });

  it('cobra el mínimo cuando el 0.3% queda por debajo de 14', () => {
    expect(m.calcularComisionBancaria(100)).toBe(14);
    expect(m.calcularComisionBancaria(4666)).toBe(14);
  });

  it('en el punto de cruce (4666.67 Bs) ya manda el porcentaje', () => {
    expect(m.calcularComisionBancaria(4666.67)).toBe(14);
    expect(m.calcularComisionBancaria(4700)).toBe(14.1);
  });

  it('calcula el 0.3% y redondea a 2 decimales', () => {
    expect(m.calcularComisionBancaria(10000)).toBe(30);
    expect(m.calcularComisionBancaria(12345.67)).toBe(37.04);
  });

  it('redondea la mitad hacia arriba igual que SQL (12345 * 0.003 = 37.035 => 37.04)', () => {
    expect(m.calcularComisionBancaria(12345)).toBe(37.04);
    expect(m.calcularComisionBancaria(25000.5)).toBe(75);
  });

  it('un monto no válido no genera comisión', () => {
    expect(m.calcularComisionBancaria(0)).toBe(0);
    expect(m.calcularComisionBancaria(-5)).toBe(0);
    expect(m.calcularComisionBancaria(Number.NaN)).toBe(0);
  });

  it('solo aplica a egresos y transferencias que debitan una cuenta en Bs', () => {
    expect(m.aplicaComisionBancaria('egreso', 'VES')).toBe(true);
    expect(m.aplicaComisionBancaria('transferencia', 'VES')).toBe(true);
    expect(m.aplicaComisionBancaria('ingreso', 'VES')).toBe(false);
    expect(m.aplicaComisionBancaria('egreso', 'USD')).toBe(false);
  });

});

describe('planificarComisionBancaria', () => {
  const base = { tipo: 'egreso' as const, moneda: 'VES', monto: 10000, saldo: 50000 };

  it('si no aplica (cuenta en USD) no pide elegir y no cobra', () => {
    expect(compartido.planificarComisionBancaria({ ...base, moneda: 'USD', lleva: null }))
      .toEqual({ ok: true, aplica: false, comision: 0, totalDebitado: 10000 });
  });

  it('en Bs es obligatorio elegir Sí o No', () => {
    const r = compartido.planificarComisionBancaria({ ...base, lleva: null });
    expect(r).toEqual({ ok: false, error: 'Indica si el movimiento lleva comisión bancaria del 0.3%.' });
  });

  it('con No, el total es solo el monto', () => {
    expect(compartido.planificarComisionBancaria({ ...base, lleva: false }))
      .toEqual({ ok: true, aplica: true, lleva: false, comision: 0, totalDebitado: 10000 });
  });

  it('con Sí, muestra la comisión y el total debitado', () => {
    expect(compartido.planificarComisionBancaria({ ...base, lleva: true }))
      .toEqual({ ok: true, aplica: true, lleva: true, comision: 30, totalDebitado: 10030 });
  });

  it('con Sí, el saldo debe alcanzar para monto + comisión', () => {
    const r = compartido.planificarComisionBancaria({ ...base, saldo: 10010, lleva: true });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toContain('comisión bancaria');
  });

  it('con No, basta con que el saldo alcance para el monto', () => {
    expect(compartido.planificarComisionBancaria({ ...base, saldo: 10000, lleva: false })).toMatchObject({ ok: true });
  });

  it('no muta la entrada', () => {
    const entrada = Object.freeze({ ...base, lleva: true });
    expect(() => compartido.planificarComisionBancaria(entrada)).not.toThrow();
  });
});
