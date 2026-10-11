import { describe, it, expect } from 'vitest';
import {
  calcularComision, montoNetoDestino, resolverMontoUsd, planificarTransferenciaMesa,
} from '../src/utils/mesa-cambio-transferencia.js';

describe('calcularComision', () => {
  it('sin comision => 0', () => {
    expect(calcularComision(1000, null)).toEqual({ ok: true, comision: 0, modo: null, porcentaje: null });
  });

  it('porcentaje sobre el bruto, redondeado a centavos', () => {
    expect(calcularComision(1234.56, { modo: 'porcentaje', valor: 1.5 })).toEqual({
      ok: true, comision: 18.52, modo: 'porcentaje', porcentaje: 1.5,
    });
  });

  it('monto manual se respeta tal cual (2 decimales)', () => {
    expect(calcularComision(500, { modo: 'monto', valor: 12.345 })).toMatchObject({ ok: true, comision: 12.35, modo: 'monto', porcentaje: null });
  });

  it('una comision en cero es valida (sin cobro)', () => {
    expect(calcularComision(500, { modo: 'porcentaje', valor: 0 })).toMatchObject({ ok: true, comision: 0 });
  });

  it('rechaza porcentaje negativo o de 100 o mas', () => {
    expect(calcularComision(500, { modo: 'porcentaje', valor: -1 })).toMatchObject({ ok: false });
    expect(calcularComision(500, { modo: 'porcentaje', valor: 100 })).toMatchObject({ ok: false });
  });

  it('rechaza monto manual negativo o que se come todo el bruto', () => {
    expect(calcularComision(500, { modo: 'monto', valor: -2 })).toMatchObject({ ok: false });
    expect(calcularComision(500, { modo: 'monto', valor: 500 })).toMatchObject({ ok: false });
    expect(calcularComision(500, { modo: 'monto', valor: 700 })).toMatchObject({ ok: false });
  });

  it('rechaza valores no numericos', () => {
    expect(calcularComision(500, { modo: 'monto', valor: Number.NaN })).toMatchObject({ ok: false });
  });
});

describe('montoNetoDestino', () => {
  it('bruto menos comision sin error de coma flotante', () => {
    expect(montoNetoDestino(100.1, 0.3)).toBe(99.8);
    expect(montoNetoDestino(1000, 0)).toBe(1000);
  });
});

describe('resolverMontoUsd', () => {
  it('origen en USD => el monto de origen', () => {
    expect(resolverMontoUsd({ monedaOrigen: 'USD', monedaDestino: 'VES', monto: 100, montoDestino: 4000 })).toEqual({ ok: true, montoUsd: 100 });
  });

  it('destino en USD => el monto bruto de destino', () => {
    expect(resolverMontoUsd({ monedaOrigen: 'VES', monedaDestino: 'USD', monto: 4000, montoDestino: 98.5 })).toEqual({ ok: true, montoUsd: 98.5 });
  });

  it('ni origen ni destino en USD => hay que informar el equivalente', () => {
    expect(resolverMontoUsd({ monedaOrigen: 'VES', monedaDestino: 'VES', monto: 4000, montoDestino: null })).toMatchObject({ ok: false });
    expect(resolverMontoUsd({ monedaOrigen: 'VES', monedaDestino: 'VES', monto: 4000, montoDestino: null, montoUsdManual: 100 })).toEqual({ ok: true, montoUsd: 100 });
  });

  it('el monto manual debe ser positivo cuando ninguna cuenta es USD', () => {
    expect(resolverMontoUsd({ monedaOrigen: 'VES', monedaDestino: 'EUR', monto: 4000, montoDestino: 90, montoUsdManual: 99.456 })).toEqual({ ok: true, montoUsd: 99.46 });
    expect(resolverMontoUsd({ monedaOrigen: 'VES', monedaDestino: 'VES', monto: 4000, montoDestino: null, montoUsdManual: 0 })).toMatchObject({ ok: false });
  });

  it('rechaza el monto manual si el origen o el destino son USD (no se ignora en silencio)', () => {
    expect(resolverMontoUsd({ monedaOrigen: 'USD', monedaDestino: 'USD', monto: 100, montoDestino: null, montoUsdManual: 99 })).toMatchObject({ ok: false, error: expect.stringContaining('USD') });
    expect(resolverMontoUsd({ monedaOrigen: 'USD', monedaDestino: 'VES', monto: 100, montoDestino: 4000, montoUsdManual: 99 })).toMatchObject({ ok: false });
    expect(resolverMontoUsd({ monedaOrigen: 'VES', monedaDestino: 'USD', monto: 4000, montoDestino: 100, montoUsdManual: 99 })).toMatchObject({ ok: false });
  });
});

describe('planificarTransferenciaMesa', () => {
  const base = { monedaOrigen: 'USD', monedaDestino: 'USD', monto: 1000, montoDestino: null, saldoOrigen: 5000 };

  it('misma moneda con comision en porcentaje: bruto = monto, neto descuenta la comision', () => {
    const r = planificarTransferenciaMesa({ ...base, comision: { modo: 'porcentaje', valor: 2 } });
    expect(r).toEqual({
      ok: true, montoUsd: 1000, montoBruto: 1000, comision: 20, montoNeto: 980, modo: 'porcentaje', porcentaje: 2,
    });
  });

  it('monedas distintas exige el monto de destino explicito', () => {
    expect(planificarTransferenciaMesa({ ...base, monedaDestino: 'VES' })).toMatchObject({ ok: false });
    const r = planificarTransferenciaMesa({ ...base, monedaDestino: 'VES', montoDestino: 40000, comision: { modo: 'monto', valor: 500 } });
    expect(r).toMatchObject({ ok: true, montoBruto: 40000, comision: 500, montoNeto: 39500, montoUsd: 1000 });
  });

  it('misma moneda ignora un monto destino sobrante', () => {
    const r = planificarTransferenciaMesa({ ...base, montoDestino: 77 });
    expect(r).toMatchObject({ ok: true, montoBruto: 1000 });
  });

  it('saldo insuficiente en el origen => rechaza', () => {
    expect(planificarTransferenciaMesa({ ...base, saldoOrigen: 999.99 })).toMatchObject({ ok: false });
  });

  it('redondea monto y monto destino a centavos antes de validar: 0.004 no es un monto valido', () => {
    expect(planificarTransferenciaMesa({ ...base, monto: 0.004 })).toMatchObject({ ok: false, error: 'El monto debe ser mayor a 0.' });
    expect(planificarTransferenciaMesa({ ...base, monedaDestino: 'VES', monto: 10, montoDestino: 0.004 })).toMatchObject({ ok: false });
  });

  it('usa los importes redondeados (0.006 pasa a 0.01) para el saldo y el plan', () => {
    expect(planificarTransferenciaMesa({ ...base, monto: 0.006, saldoOrigen: 0.01 })).toMatchObject({ ok: true, montoBruto: 0.01, montoUsd: 0.01 });
    expect(planificarTransferenciaMesa({ ...base, monto: 10.004, saldoOrigen: 10 })).toMatchObject({ ok: true, montoBruto: 10 });
  });

  it('propaga el error de comision', () => {
    expect(planificarTransferenciaMesa({ ...base, comision: { modo: 'monto', valor: 1000 } })).toMatchObject({ ok: false });
  });
});

import * as compartido from '../../shared/types/mesa-cambio-transferencia';
import * as backend from '../src/utils/mesa-cambio-transferencia.js';

describe('paridad shared / backend', () => {
  const entradas = [
    { monedaOrigen: 'USD', monedaDestino: 'USD', monto: 1000, montoDestino: null, saldoOrigen: 5000, comision: { modo: 'porcentaje' as const, valor: 2.5 } },
    { monedaOrigen: 'USD', monedaDestino: 'VES', monto: 100, montoDestino: 4100, saldoOrigen: 100, comision: { modo: 'monto' as const, valor: 33.333 } },
    { monedaOrigen: 'VES', monedaDestino: 'VES', monto: 100, montoDestino: null, saldoOrigen: 10 },
    { monedaOrigen: 'VES', monedaDestino: 'VES', monto: 100, montoDestino: null, saldoOrigen: 1000, montoUsdManual: 2.7 },
    { monedaOrigen: 'USD', monedaDestino: 'USD', monto: 100, montoDestino: null, saldoOrigen: 1000, montoUsdManual: 2.7 },
    { monedaOrigen: 'VES', monedaDestino: 'VES', monto: 0.004, montoDestino: null, saldoOrigen: 1000, montoUsdManual: 2.7 },
  ];
  it.each(entradas)('mismo plan para %o', e => {
    expect(compartido.planificarTransferenciaMesa(e)).toEqual(backend.planificarTransferenciaMesa(e));
  });
});
