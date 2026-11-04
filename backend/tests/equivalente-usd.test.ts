import { describe, it, expect } from 'vitest';
import { equivalentesDeBs, usdDesdeBs, type TasasUsd } from '../../shared/types/equivalente-usd.js';

const tasas: TasasUsd = {
  binance: { tasa: 600, fecha: '2026-10-11T15:00:00Z' },
  bcv: { tasa: 500, fecha: '2026-10-11T12:00:00Z' },
};

describe('usdDesdeBs', () => {
  it('divide entre la tasa y redondea a 2 decimales', () => {
    expect(usdDesdeBs(1000, 600)).toBe(1.67);
    expect(usdDesdeBs(60000, 500)).toBe(120);
  });

  it('sin tasa válida devuelve null (no inventa)', () => {
    expect(usdDesdeBs(1000, null)).toBeNull();
    expect(usdDesdeBs(1000, undefined)).toBeNull();
    expect(usdDesdeBs(1000, 0)).toBeNull();
    expect(usdDesdeBs(1000, Number.NaN)).toBeNull();
  });

  it('un monto no finito devuelve null', () => {
    expect(usdDesdeBs(Number.NaN, 600)).toBeNull();
  });

  it('un saldo negativo conserva el signo', () => {
    expect(usdDesdeBs(-1200, 600)).toBe(-2);
  });

  it('cero Bs son cero USD', () => {
    expect(usdDesdeBs(0, 600)).toBe(0);
  });
});

describe('equivalentesDeBs', () => {
  it('devuelve dos líneas: Binance y BCV, cada una con su tasa y fecha', () => {
    expect(equivalentesDeBs(6000, tasas)).toEqual([
      { fuente: 'Binance', tasa: 600, fecha: '2026-10-11T15:00:00Z', usd: 10 },
      { fuente: 'BCV', tasa: 500, fecha: '2026-10-11T12:00:00Z', usd: 12 },
    ]);
  });

  it('si una tasa no está disponible lo indica y la otra sigue', () => {
    expect(equivalentesDeBs(6000, { ...tasas, binance: null })).toEqual([
      { fuente: 'Binance', tasa: null, fecha: null, usd: null },
      { fuente: 'BCV', tasa: 500, fecha: '2026-10-11T12:00:00Z', usd: 12 },
    ]);
  });

  it('un monto vacío o cero no genera equivalentes', () => {
    expect(equivalentesDeBs(0, tasas)).toEqual([]);
    expect(equivalentesDeBs(Number.NaN, tasas)).toEqual([]);
  });
});
