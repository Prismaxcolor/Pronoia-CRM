import { describe, it, expect } from 'vitest';
import {
  calcularCruce,
  redondear2,
  sugerirMontoCredito,
  validarMontoAplicable,
  type ItemCruce,
} from '../../frontend/src/lib/cruce';

const factura = (montoUsd: number): ItemCruce => ({ tipo: 'factura', montoUsd });
const adelanto = (montoUsd: number): ItemCruce => ({ tipo: 'adelanto', montoUsd });
const nc = (montoUsd: number): ItemCruce => ({ tipo: 'nota_credito', montoUsd });
const nd = (montoUsd: number): ItemCruce => ({ tipo: 'nota_debito', montoUsd });

describe('calcularCruce', () => {
  it('sin items: nada que pagar y no es cruce', () => {
    const r = calcularCruce([]);
    expect(r.efectivo).toBe(0);
    expect(r.esCrucePuro).toBe(false);
    expect(r.error).toBeNull();
  });

  it('solo facturas: el efectivo es el total de las facturas', () => {
    const r = calcularCruce([factura(100), factura(50.5)]);
    expect(r.totalFacturas).toBe(150.5);
    expect(r.efectivo).toBe(150.5);
    expect(r.esCrucePuro).toBe(false);
  });

  it('desglose: facturas - adelantos - NC + ND = efectivo', () => {
    const r = calcularCruce([factura(100), adelanto(60), nc(10), nd(5)]);
    expect(r.totalCargos).toBe(105);
    expect(r.totalCreditos).toBe(70);
    expect(r.totalAdelantos).toBe(60);
    expect(r.totalNotasCredito).toBe(10);
    expect(r.totalNotasDebito).toBe(5);
    expect(r.efectivo).toBe(35);
    expect(r.error).toBeNull();
  });

  it('adelanto que cubre exactamente la factura: cruce puro con efectivo 0', () => {
    const r = calcularCruce([factura(80), adelanto(80)]);
    expect(r.efectivo).toBe(0);
    expect(r.esCrucePuro).toBe(true);
    expect(r.error).toBeNull();
  });

  it('adelanto + nota de credito cubren la factura: cruce puro', () => {
    const r = calcularCruce([factura(50), adelanto(40), nc(10)]);
    expect(r.efectivo).toBe(0);
    expect(r.esCrucePuro).toBe(true);
  });

  it('creditos mayores que los cargos: error y sin cruce puro', () => {
    const r = calcularCruce([factura(50), adelanto(60)]);
    expect(r.error).toMatch(/superan/);
    expect(r.esCrucePuro).toBe(false);
    expect(r.efectivo).toBe(0);
  });

  it('tolera un centavo de diferencia (redondeo) y lo deja en 0', () => {
    const r = calcularCruce([factura(33.33), adelanto(33.32)]);
    expect(r.error).toBeNull();
    expect(r.efectivo).toBe(0);
    expect(r.esCrucePuro).toBe(true);
  });

  it('no acumula error de punto flotante (0.1 + 0.2)', () => {
    const r = calcularCruce([factura(0.1), factura(0.2)]);
    expect(r.totalFacturas).toBe(0.3);
    expect(r.efectivo).toBe(0.3);
  });

  it('monto cero, negativo o no numerico en un item es error', () => {
    expect(calcularCruce([factura(0)]).error).toMatch(/mayor a 0/);
    expect(calcularCruce([factura(10), adelanto(-5)]).error).toMatch(/mayor a 0/);
    expect(calcularCruce([factura(Number.NaN)]).error).toMatch(/mayor a 0/);
  });

  it('una nota de debito suma al efectivo', () => {
    const r = calcularCruce([factura(20), nd(5), adelanto(10)]);
    expect(r.efectivo).toBe(15);
  });
});

describe('sugerirMontoCredito', () => {
  it('sugiere lo que falta si el disponible alcanza', () => {
    expect(sugerirMontoCredito(100, 40)).toBe(40);
  });
  it('sugiere todo el disponible si no alcanza lo que falta', () => {
    expect(sugerirMontoCredito(30, 80)).toBe(30);
  });
  it('sugiere 0 si ya no falta nada', () => {
    expect(sugerirMontoCredito(30, 0)).toBe(0);
    expect(sugerirMontoCredito(30, -5)).toBe(0);
  });
  it('redondea a 2 decimales', () => {
    expect(sugerirMontoCredito(10.005, 99)).toBe(10.01);
  });
});

describe('validarMontoAplicable', () => {
  it('acepta hasta el disponible con tolerancia de un centavo', () => {
    expect(validarMontoAplicable(50, 50, 'AD-0001')).toBeNull();
    expect(validarMontoAplicable(50.01, 50, 'AD-0001')).toBeNull();
  });
  it('rechaza mas que el disponible', () => {
    expect(validarMontoAplicable(50.02, 50, 'AD-0001')).toMatch(/AD-0001.*supera/);
  });
  it('rechaza monto cero o negativo', () => {
    expect(validarMontoAplicable(0, 50, 'C-0001')).toMatch(/mayor a 0/);
    expect(validarMontoAplicable(-1, 50, 'C-0001')).toMatch(/mayor a 0/);
  });
});

describe('redondear2', () => {
  it('redondea a 2 decimales sin errores de flotante', () => {
    expect(redondear2(1.005)).toBe(1.01);
    expect(redondear2(0.1 + 0.2)).toBe(0.3);
    expect(redondear2(-2.5)).toBe(-2.5);
  });
});
