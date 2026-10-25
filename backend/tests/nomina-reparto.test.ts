import { describe, it, expect } from 'vitest';
import { aCentavos, MAX_CUENTAS_POR_MONEDA, normalizarReparto, textoCentavos, tieneDosDecimales } from '../src/utils/nomina-reparto';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('aCentavos / tieneDosDecimales', () => {
  it('convierte sin errores de coma flotante', () => {
    expect(aCentavos(0.1 + 0.2)).toBe(30);
    expect(aCentavos(20.1)).toBe(2010);
  });
  it('acepta como máximo 2 decimales', () => {
    expect(tieneDosDecimales(10)).toBe(true);
    expect(tieneDosDecimales(10.25)).toBe(true);
    expect(tieneDosDecimales(0.1 + 0.2)).toBe(true);
    expect(tieneDosDecimales(10.255)).toBe(false);
    expect(tieneDosDecimales(Number.NaN)).toBe(false);
  });
  it('textoCentavos', () => {
    expect(textoCentavos(1050)).toBe('10.50');
  });
});

describe('normalizarReparto', () => {
  it('una sola cuenta sin monto paga todo', () => {
    expect(normalizarReparto([{ bancaId: A }], 3000)).toEqual({ cuentas: [{ bancaId: A, centavos: 3000 }] });
  });

  it('una sola cuenta con el monto exacto también vale', () => {
    expect(normalizarReparto([{ bancaId: A, monto: 30 }], 3000)).toEqual({ cuentas: [{ bancaId: A, centavos: 3000 }] });
  });

  it('30 USD = 20 + 10 entre dos cuentas', () => {
    expect(normalizarReparto([{ bancaId: A, monto: 20 }, { bancaId: B, monto: 10 }], 3000)).toEqual({
      cuentas: [{ bancaId: A, centavos: 2000 }, { bancaId: B, centavos: 1000 }],
    });
  });

  it('suma exacta en centavos aunque los flotantes no cuadren (0.1 + 0.2 = 0.3)', () => {
    expect(normalizarReparto([{ bancaId: A, monto: 0.1 }, { bancaId: B, monto: 0.2 }], 30)).toMatchObject({ cuentas: expect.any(Array) });
  });

  it('con varias cuentas todas llevan monto', () => {
    expect(normalizarReparto([{ bancaId: A, monto: 20 }, { bancaId: B }], 3000)).toMatchObject({ codigo: 400, error: expect.stringMatching(/monto de cada cuenta/i) });
  });

  it('la suma debe ser exacta: falta o excede', () => {
    expect(normalizarReparto([{ bancaId: A, monto: 20 }, { bancaId: B, monto: 9.99 }], 3000))
      .toMatchObject({ codigo: 400, error: expect.stringMatching(/faltan 0\.01/) });
    expect(normalizarReparto([{ bancaId: A, monto: 20 }, { bancaId: B, monto: 10.5 }], 3000))
      .toMatchObject({ codigo: 400, error: expect.stringMatching(/excede en 0\.50/) });
    expect(normalizarReparto([{ bancaId: A, monto: 29 }], 3000)).toMatchObject({ codigo: 400 });
  });

  it('no repite cuenta', () => {
    expect(normalizarReparto([{ bancaId: A, monto: 20 }, { bancaId: A, monto: 10 }], 3000)).toMatchObject({ codigo: 400, error: expect.stringMatching(/repetirse/) });
  });

  it('cada monto es mayor a cero y con 2 decimales como máximo', () => {
    expect(normalizarReparto([{ bancaId: A, monto: 30 }, { bancaId: B, monto: 0 }], 3000)).toMatchObject({ codigo: 400, error: expect.stringMatching(/mayor a cero/) });
    expect(normalizarReparto([{ bancaId: A, monto: 30.5 }, { bancaId: B, monto: -0.5 }], 3000)).toMatchObject({ codigo: 400 });
    expect(normalizarReparto([{ bancaId: A, monto: 15.005 }, { bancaId: B, monto: 14.995 }], 3000)).toMatchObject({ codigo: 400, error: expect.stringMatching(/2 decimales/) });
  });

  it('máximo de cuentas por moneda', () => {
    const muchas = Array.from({ length: MAX_CUENTAS_POR_MONEDA + 1 }, (_, i) => ({ bancaId: `b${i}`, monto: 1 }));
    expect(normalizarReparto(muchas, muchas.length * 100)).toMatchObject({ codigo: 400, error: expect.stringMatching(/Máximo/) });
    const justo = Array.from({ length: MAX_CUENTAS_POR_MONEDA }, (_, i) => ({ bancaId: `b${i}`, monto: 1 }));
    expect(normalizarReparto(justo, justo.length * 100)).toMatchObject({ cuentas: expect.any(Array) });
  });

  it('sin cuentas: 400', () => {
    expect(normalizarReparto([], 100)).toMatchObject({ codigo: 400 });
  });

  it('tres cuentas', () => {
    const r = normalizarReparto([{ bancaId: A, monto: 10 }, { bancaId: B, monto: 10 }, { bancaId: C, monto: 10 }], 3000);
    expect(r).toMatchObject({ cuentas: [{ centavos: 1000 }, { centavos: 1000 }, { centavos: 1000 }] });
  });
});
