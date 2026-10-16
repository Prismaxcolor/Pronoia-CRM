import { describe, it, expect } from 'vitest';
import { filtroCategoriaPagoSchema, pagarNominaSchema } from '../src/schemas/nomina';
import { MONEDA_CUENTA, monedasPorPagar, planificarPagos, type CuentaWallet } from '../src/utils/nomina-pago';

const B_USD = '11111111-1111-4111-8111-111111111111';
const B_VES = '22222222-2222-4222-8222-222222222222';
const B_OTRA = '33333333-3333-4333-8333-333333333333';

const cuentas: CuentaWallet[] = [
  { id: B_USD, nombre: 'CAJA CHICA', moneda: 'USD', archivada: false },
  { id: B_VES, nombre: 'CAJA BS', moneda: 'VES', archivada: false },
  { id: B_OTRA, nombre: 'CAJA VIEJA', moneda: 'USD', archivada: true },
];

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
    const r = planificarPagos(['USD', 'BS'], [{ moneda: 'USD', bancaId: B_USD }, { moneda: 'BS', bancaId: B_VES, llevaComision: false }], cuentas, true);
    expect(r).toEqual({ pagos: [{ moneda: 'USD', bancaId: B_USD, llevaComision: null }, { moneda: 'BS', bancaId: B_VES, llevaComision: false }] });
  });

  it('en Bs sin elegir comisión: 400 si la comisión está disponible; sin la migración se paga sin comisión', () => {
    const pagos = [{ moneda: 'BS' as const, bancaId: B_VES }];
    expect(planificarPagos(['BS'], pagos, cuentas, true)).toMatchObject({ codigo: 400, error: expect.stringMatching(/comisión/i) });
    expect(planificarPagos(['BS'], pagos, cuentas, false)).toEqual({ pagos: [{ moneda: 'BS', bancaId: B_VES, llevaComision: null }] });
  });

  it('comisión pedida sin la migración: 503; comisión en una cuenta USD: 400', () => {
    expect(planificarPagos(['BS'], [{ moneda: 'BS', bancaId: B_VES, llevaComision: true }], cuentas, false)).toMatchObject({ codigo: 503 });
    expect(planificarPagos(['USD'], [{ moneda: 'USD', bancaId: B_USD, llevaComision: true }], cuentas, true)).toMatchObject({ codigo: 400 });
  });

  it('exige exactamente las monedas con montos: ni faltan ni sobran', () => {
    expect(planificarPagos(['USD', 'BS'], [{ moneda: 'USD', bancaId: B_USD }], cuentas, true)).toMatchObject({ codigo: 400 });
    expect(planificarPagos(['USD'], [{ moneda: 'USD', bancaId: B_USD }, { moneda: 'BS', bancaId: B_VES, llevaComision: false }], cuentas, true)).toMatchObject({ codigo: 400 });
  });

  it('rechaza una cuenta de otra moneda, archivada o inexistente', () => {
    expect(planificarPagos(['USD'], [{ moneda: 'USD', bancaId: B_VES }], cuentas, true)).toMatchObject({ codigo: 400, error: expect.stringMatching(/VES/) });
    expect(planificarPagos(['USD'], [{ moneda: 'USD', bancaId: B_OTRA }], cuentas, true)).toMatchObject({ codigo: 400, error: expect.stringMatching(/archivada/) });
    expect(planificarPagos(['USD'], [{ moneda: 'USD', bancaId: '99999999-9999-4999-8999-999999999999' }], cuentas, true)).toMatchObject({ codigo: 400 });
  });

  it('la moneda de cuenta de cada moneda de pago', () => {
    expect(MONEDA_CUENTA).toEqual({ USD: 'USD', BS: 'VES' });
  });
});
