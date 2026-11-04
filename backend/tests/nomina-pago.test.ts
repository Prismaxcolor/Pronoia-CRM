import { describe, it, expect } from 'vitest';
import { filtroCategoriaPagoSchema, pagarNominaSchema } from '../src/schemas/nomina';
import { MONEDA_CUENTA, monedasPorPagar, montosPorPagar, planificarPagos, type CuentaWallet, type MontosPorMoneda } from '../src/utils/nomina-pago';

const B_USD = '11111111-1111-4111-8111-111111111111';
const B_VES = '22222222-2222-4222-8222-222222222222';
const B_OTRA = '33333333-3333-4333-8333-333333333333';

const cuentas: CuentaWallet[] = [
  { id: B_USD, nombre: 'CAJA CHICA', moneda: 'USD', archivada: false },
  { id: B_VES, nombre: 'CAJA BS', moneda: 'VES', archivada: false },
  { id: B_OTRA, nombre: 'CAJA VIEJA', moneda: 'USD', archivada: true },
];

/** Lo que se debe pagar: 100 USD y 2000 Bs (en centavos). */
const MONTOS: MontosPorMoneda = { USD: 10000, BS: 200000 };

describe('pagarNominaSchema', () => {
  const valido = { fecha: '2026-10-09', bancas: [{ moneda: 'USD', bancaId: B_USD }, { moneda: 'BS', bancaId: B_VES, llevaComision: true }] };

  it('acepta una cuenta por moneda, con referencia opcional recortada', () => {
    const r = pagarNominaSchema.parse({ ...valido, referencia: '  REF-1  ' });
    expect(r.referencia).toBe('REF-1');
    expect(r.bancas).toHaveLength(2);
  });

  it('la referencia vacía queda en null', () => {
    expect(pagarNominaSchema.parse({ ...valido, referencia: '   ' }).referencia).toBeNull();
  });

  it('rechaza fecha inválida o inexistente', () => {
    expect(pagarNominaSchema.safeParse({ ...valido, fecha: '09/10/2026' }).success).toBe(false);
    expect(pagarNominaSchema.safeParse({ ...valido, fecha: '2026-02-30' }).success).toBe(false);
  });

  it('rechaza sin cuentas, con más de dos o con una moneda repetida', () => {
    expect(pagarNominaSchema.safeParse({ ...valido, bancas: [] }).success).toBe(false);
    expect(pagarNominaSchema.safeParse({ ...valido, bancas: [{ moneda: 'USD', bancaId: B_USD }, { moneda: 'USD', bancaId: B_OTRA }] }).success).toBe(false);
    expect(pagarNominaSchema.safeParse({
      ...valido, bancas: [{ moneda: 'USD', bancaId: B_USD }, { moneda: 'BS', bancaId: B_VES }, { moneda: 'USD', bancaId: B_OTRA }],
    }).success).toBe(false);
  });

  it('rechaza la misma cuenta para dos monedas', () => {
    expect(pagarNominaSchema.safeParse({ ...valido, bancas: [{ moneda: 'USD', bancaId: B_USD }, { moneda: 'BS', bancaId: B_USD }] }).success).toBe(false);
  });

  it('rechaza moneda desconocida, cuenta que no es uuid y referencia larga', () => {
    expect(pagarNominaSchema.safeParse({ ...valido, bancas: [{ moneda: 'EUR', bancaId: B_USD }] }).success).toBe(false);
    expect(pagarNominaSchema.safeParse({ ...valido, bancas: [{ moneda: 'USD', bancaId: 'abc' }] }).success).toBe(false);
    expect(pagarNominaSchema.safeParse({ ...valido, referencia: 'x'.repeat(51) }).success).toBe(false);
  });

  it('descarta los campos que el cliente no debe mandar (monto, categoría)', () => {
    const r = pagarNominaSchema.parse({ ...valido, monto: 1, categoriaId: B_USD });
    expect(r).not.toHaveProperty('monto');
    expect(r).not.toHaveProperty('categoriaId');
  });
});

describe('filtroCategoriaPagoSchema', () => {
  it('exige el tipo de personal', () => {
    expect(filtroCategoriaPagoSchema.safeParse({}).success).toBe(false);
    expect(filtroCategoriaPagoSchema.safeParse({ tipo: 'OPERATIVO' }).success).toBe(true);
    expect(filtroCategoriaPagoSchema.safeParse({ tipo: 'OTRO' }).success).toBe(false);
  });
});

describe('monedasPorPagar', () => {
  it('devuelve USD y/o BS según haya montos por pagar', () => {
    expect(monedasPorPagar([{ pagarUsd: 100, pagarBs: 0 }, { pagarUsd: 0, pagarBs: 2000 }])).toEqual(['USD', 'BS']);
    expect(monedasPorPagar([{ pagarUsd: 100, pagarBs: 0 }])).toEqual(['USD']);
    expect(monedasPorPagar([{ pagarUsd: 0, pagarBs: 2000 }])).toEqual(['BS']);
  });

  it('un trabajador con las dos partes alimenta las dos monedas', () => {
    expect(monedasPorPagar([{ pagarUsd: 60, pagarBs: 1500 }])).toEqual(['USD', 'BS']);
  });

  it('un grupo con total cero no se paga; sin nada por pagar devuelve vacío', () => {
    expect(monedasPorPagar([{ pagarUsd: 0, pagarBs: 0 }, { pagarUsd: 0, pagarBs: null }])).toEqual([]);
    expect(monedasPorPagar([])).toEqual([]);
  });

  it('suma en centavos (sin error de coma flotante)', () => {
    expect(monedasPorPagar([{ pagarUsd: 0.1, pagarBs: 0 }, { pagarUsd: 0.2, pagarBs: 0 }])).toEqual(['USD']);
  });
});

describe('planificarPagos', () => {
  it('cada moneda con su cuenta; la comisión solo aplica en Bs y es obligatoria elegirla si está disponible', () => {
    const r = planificarPagos(['USD', 'BS'], [{ moneda: 'USD', bancaId: B_USD }, { moneda: 'BS', bancaId: B_VES, llevaComision: false }], cuentas, true, MONTOS);
    expect(r).toEqual({ pagos: [{ moneda: 'USD', bancaId: B_USD, llevaComision: null }, { moneda: 'BS', bancaId: B_VES, llevaComision: false }] });
  });

  it('en Bs sin elegir comisión: 400 si la comisión está disponible; sin la migración se paga sin comisión', () => {
    const pagos = [{ moneda: 'BS' as const, bancaId: B_VES }];
    expect(planificarPagos(['BS'], pagos, cuentas, true, MONTOS)).toMatchObject({ codigo: 400, error: expect.stringMatching(/comisión/i) });
    expect(planificarPagos(['BS'], pagos, cuentas, false, MONTOS)).toEqual({ pagos: [{ moneda: 'BS', bancaId: B_VES, llevaComision: null }] });
  });

  it('comisión pedida sin la migración: 503; comisión en una cuenta USD: 400', () => {
    expect(planificarPagos(['BS'], [{ moneda: 'BS', bancaId: B_VES, llevaComision: true }], cuentas, false, MONTOS)).toMatchObject({ codigo: 503 });
    expect(planificarPagos(['USD'], [{ moneda: 'USD', bancaId: B_USD, llevaComision: true }], cuentas, true, MONTOS)).toMatchObject({ codigo: 400 });
  });

  it('exige exactamente las monedas con montos: ni faltan ni sobran', () => {
    expect(planificarPagos(['USD', 'BS'], [{ moneda: 'USD', bancaId: B_USD }], cuentas, true, MONTOS)).toMatchObject({ codigo: 400 });
    expect(planificarPagos(['USD'], [{ moneda: 'USD', bancaId: B_USD }, { moneda: 'BS', bancaId: B_VES, llevaComision: false }], cuentas, true, MONTOS)).toMatchObject({ codigo: 400 });
  });

  it('rechaza una cuenta de otra moneda, archivada o inexistente', () => {
    expect(planificarPagos(['USD'], [{ moneda: 'USD', bancaId: B_VES }], cuentas, true, MONTOS)).toMatchObject({ codigo: 400, error: expect.stringMatching(/VES/) });
    expect(planificarPagos(['USD'], [{ moneda: 'USD', bancaId: B_OTRA }], cuentas, true, MONTOS)).toMatchObject({ codigo: 400, error: expect.stringMatching(/archivada/) });
    expect(planificarPagos(['USD'], [{ moneda: 'USD', bancaId: '99999999-9999-4999-8999-999999999999' }], cuentas, true, MONTOS)).toMatchObject({ codigo: 400 });
  });

  it('la moneda de cuenta de cada moneda de pago', () => {
    expect(MONEDA_CUENTA).toEqual({ USD: 'USD', BS: 'VES' });
  });
});

describe('montosPorPagar', () => {
  it('suma en centavos por moneda', () => {
    expect(montosPorPagar([{ pagarUsd: 0.1, pagarBs: null }, { pagarUsd: 0.2, pagarBs: 1500.5 }])).toEqual({ USD: 30, BS: 150050 });
    expect(montosPorPagar([])).toEqual({ USD: 0, BS: 0 });
  });
});

describe('reparto entre varias cuentas de la misma moneda', () => {
  const B_BINANCE = '44444444-4444-4444-8444-444444444444';
  const B_VES2 = '55555555-5555-4555-8555-555555555555';
  const todas: CuentaWallet[] = [
    ...cuentas,
    { id: B_BINANCE, nombre: 'CAJA BINANCE PS', moneda: 'USD', archivada: false },
    { id: B_VES2, nombre: 'BANCO BS 2', moneda: 'VES', archivada: false },
  ];
  const USD30: MontosPorMoneda = { USD: 3000, BS: 0 };

  it('30 USD = 20 de CAJA BINANCE PS + 10 de CAJA CHICA: ambas pasan con su monto', () => {
    const r = planificarPagos(['USD'], [{ moneda: 'USD', bancaId: B_BINANCE, monto: 20 }, { moneda: 'USD', bancaId: B_USD, monto: 10 }], todas, true, USD30);
    expect(r).toEqual({ pagos: [
      { moneda: 'USD', bancaId: B_BINANCE, llevaComision: null, monto: 20 },
      { moneda: 'USD', bancaId: B_USD, llevaComision: null, monto: 10 },
    ] });
  });

  it('un pago sin monto no lo agrega al plan (la BD calcula el total)', () => {
    const r = planificarPagos(['USD'], [{ moneda: 'USD', bancaId: B_USD }], todas, true, USD30);
    expect(r).toEqual({ pagos: [{ moneda: 'USD', bancaId: B_USD, llevaComision: null }] });
  });

  it('la suma debe ser exactamente la parte a pagar', () => {
    const r = planificarPagos(['USD'], [{ moneda: 'USD', bancaId: B_BINANCE, monto: 20 }, { moneda: 'USD', bancaId: B_USD, monto: 9 }], todas, true, USD30);
    expect(r).toMatchObject({ codigo: 400, error: expect.stringMatching(/sumar exactamente 30\.00/) });
  });

  it('no repite cuenta y exige monto en cada cuenta', () => {
    expect(planificarPagos(['USD'], [{ moneda: 'USD', bancaId: B_USD, monto: 10 }, { moneda: 'USD', bancaId: B_USD, monto: 20 }], todas, true, USD30)).toMatchObject({ codigo: 400 });
    expect(planificarPagos(['USD'], [{ moneda: 'USD', bancaId: B_USD }, { moneda: 'USD', bancaId: B_BINANCE, monto: 20 }], todas, true, USD30)).toMatchObject({ codigo: 400 });
  });

  it('cada cuenta se valida: otra moneda o archivada dentro del reparto', () => {
    expect(planificarPagos(['USD'], [{ moneda: 'USD', bancaId: B_VES, monto: 10 }, { moneda: 'USD', bancaId: B_USD, monto: 20 }], todas, true, USD30)).toMatchObject({ codigo: 400, error: expect.stringMatching(/VES/) });
    expect(planificarPagos(['USD'], [{ moneda: 'USD', bancaId: B_OTRA, monto: 10 }, { moneda: 'USD', bancaId: B_USD, monto: 20 }], todas, true, USD30)).toMatchObject({ codigo: 400, error: expect.stringMatching(/archivada/) });
  });

  it('Bs repartido: cada cuenta Bs lleva su comisión Sí/No independiente', () => {
    const bs: MontosPorMoneda = { USD: 0, BS: 200000 };
    const r = planificarPagos(['BS'], [
      { moneda: 'BS', bancaId: B_VES, monto: 1500, llevaComision: true }, { moneda: 'BS', bancaId: B_VES2, monto: 500, llevaComision: false },
    ], todas, true, bs);
    expect(r).toEqual({ pagos: [
      { moneda: 'BS', bancaId: B_VES, llevaComision: true, monto: 1500 }, { moneda: 'BS', bancaId: B_VES2, llevaComision: false, monto: 500 },
    ] });
    expect(planificarPagos(['BS'], [
      { moneda: 'BS', bancaId: B_VES, monto: 1500, llevaComision: true }, { moneda: 'BS', bancaId: B_VES2, monto: 500 },
    ], todas, true, bs)).toMatchObject({ codigo: 400, error: expect.stringMatching(/comisión/i) });
  });

  it('dos monedas, cada una con su reparto', () => {
    const r = planificarPagos(['USD', 'BS'], [
      { moneda: 'USD', bancaId: B_USD, monto: 60 }, { moneda: 'USD', bancaId: B_BINANCE, monto: 40 },
      { moneda: 'BS', bancaId: B_VES, monto: 1000, llevaComision: false }, { moneda: 'BS', bancaId: B_VES2, monto: 1000, llevaComision: false },
    ], todas, true, MONTOS);
    expect('pagos' in r && r.pagos).toHaveLength(4);
  });
});

describe('pagarNominaSchema con reparto', () => {
  const base = { fecha: '2026-10-09' };
  const B1 = '44444444-4444-4444-8444-444444444444';

  it('acepta varias cuentas en la misma moneda con monto', () => {
    const r = pagarNominaSchema.safeParse({ ...base, bancas: [{ moneda: 'USD', bancaId: B_USD, monto: 10 }, { moneda: 'USD', bancaId: B1, monto: 20.5 }] });
    expect(r.success).toBe(true);
  });

  it('varias cuentas en una moneda exigen monto en todas', () => {
    const r = pagarNominaSchema.safeParse({ ...base, bancas: [{ moneda: 'USD', bancaId: B_USD }, { moneda: 'USD', bancaId: B1, monto: 20 }] });
    expect(r.success).toBe(false);
  });

  it('rechaza cuenta repetida, monto <= 0, más de 2 decimales y más de 5 cuentas por moneda', () => {
    expect(pagarNominaSchema.safeParse({ ...base, bancas: [{ moneda: 'USD', bancaId: B_USD, monto: 1 }, { moneda: 'USD', bancaId: B_USD, monto: 2 }] }).success).toBe(false);
    expect(pagarNominaSchema.safeParse({ ...base, bancas: [{ moneda: 'USD', bancaId: B_USD, monto: 0 }] }).success).toBe(false);
    expect(pagarNominaSchema.safeParse({ ...base, bancas: [{ moneda: 'USD', bancaId: B_USD, monto: 1.234 }] }).success).toBe(false);
    const seis = Array.from({ length: 6 }, (_, i) => ({ moneda: 'USD', bancaId: `${i}0000000-0000-4000-8000-000000000000`, monto: 1 }));
    expect(pagarNominaSchema.safeParse({ ...base, bancas: seis }).success).toBe(false);
  });

  it('sigue aceptando una cuenta por moneda sin monto (compatibilidad)', () => {
    expect(pagarNominaSchema.safeParse({ ...base, bancas: [{ moneda: 'USD', bancaId: B_USD }, { moneda: 'BS', bancaId: B_VES, llevaComision: true }] }).success).toBe(true);
  });
});
