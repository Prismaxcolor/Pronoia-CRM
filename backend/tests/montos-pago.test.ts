import { describe, it, expect, vi, beforeEach } from 'vitest';

const bd = vi.hoisted(() => ({
  filas: [] as Array<{ fuente: string; tasa: number | string; fecha: string }>,
  error: null as { message: string } | null,
  lanza: false,
  consultas: 0,
}));

vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: () => {
      bd.consultas += 1;
      if (bd.lanza) throw new Error('red caída');
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order']) c[m] = () => c;
      c.limit = () => Promise.resolve({ data: bd.error ? null : bd.filas, error: bd.error });
      return c;
    },
  },
}));
vi.mock('../src/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, clienteIp: () => '' }));

import {
  validarCoherenciaMonto, TOLERANCIA_TASA_IMPLICITA, TOLERANCIA_TASA_EXPLICITA,
} from '../src/utils/coherencia-monto-pago.js';
import { tasasUsdVesVigentes, validarMontosDeLineas } from '../src/services/montos-pago-service.js';
import { MONTO_MAXIMO_USD, MONTO_MAXIMO_MONEDA_CUENTA } from '../src/schemas/montos-pago.js';
import { registrarPagoSchema, registrarPagoMultipleSchema } from '../src/schemas/pagos.js';
import { registrarCobroMultipleSchema } from '../src/schemas/cobros.js';

const U = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const F = '44444444-4444-4444-8444-444444444444';

describe('validarCoherenciaMonto', () => {
  const vigentes = [480, 600]; // BCV y Binance

  it('USD: montoUsd debe ser igual a monto (tolera un centavo de redondeo)', () => {
    expect(validarCoherenciaMonto({ monto: 100, montoUsd: 100, moneda: 'USD' }, { tasasVigentes: [] })).toBeNull();
    expect(validarCoherenciaMonto({ monto: 100, montoUsd: 100.01, moneda: 'USD' }, { tasasVigentes: [] })).toBeNull();
    expect(validarCoherenciaMonto({ monto: 100, montoUsd: 90, moneda: 'USD' }, { tasasVigentes: [] })).toMatch(/debe ser igual al monto/);
  });

  it('Bs: acepta una tasa implícita dentro del rango de las vigentes (BCV..Binance)', () => {
    expect(validarCoherenciaMonto({ monto: 48000, montoUsd: 100, moneda: 'VES' }, { tasasVigentes: vigentes })).toBeNull();
    expect(validarCoherenciaMonto({ monto: 60000, montoUsd: 100, moneda: 'VES' }, { tasasVigentes: vigentes })).toBeNull();
    expect(validarCoherenciaMonto({ monto: 54000, montoUsd: 100, moneda: 'VES' }, { tasasVigentes: vigentes })).toBeNull();
  });

  it('Bs: tolera una tasa manual hasta la tolerancia configurable por encima y por debajo', () => {
    const arriba = 600 * (1 + TOLERANCIA_TASA_IMPLICITA) * 100;
    const abajo = 480 * (1 - TOLERANCIA_TASA_IMPLICITA) * 100;
    expect(validarCoherenciaMonto({ monto: arriba - 1, montoUsd: 100, moneda: 'VES' }, { tasasVigentes: vigentes })).toBeNull();
    expect(validarCoherenciaMonto({ monto: abajo + 1, montoUsd: 100, moneda: 'VES' }, { tasasVigentes: vigentes })).toBeNull();
  });

  it('Bs: rechaza con mensaje claro un cero de más o de menos', () => {
    const exceso = validarCoherenciaMonto({ monto: 480000, montoUsd: 100, moneda: 'VES' }, { tasasVigentes: vigentes });
    expect(exceso).toMatch(/implican una tasa de .* Bs por USD, fuera de lo razonable/);
    expect(exceso).toMatch(/Revisa los montos/);
    expect(validarCoherenciaMonto({ monto: 4800, montoUsd: 100, moneda: 'VES' }, { tasasVigentes: vigentes })).toMatch(/fuera de lo razonable/);
  });

  it('la tolerancia es configurable por llamada', () => {
    const l = { monto: 66000, montoUsd: 100, moneda: 'VES' as const }; // 660 Bs/USD, 10% sobre Binance
    expect(validarCoherenciaMonto(l, { tasasVigentes: [600], toleranciaImplicita: 0.05 })).not.toBeNull();
    expect(validarCoherenciaMonto(l, { tasasVigentes: [600], toleranciaImplicita: 0.15 })).toBeNull();
  });

  it('Bs sin tasas vigentes: no se cruza (no se bloquea el pago por falta de datos)', () => {
    expect(validarCoherenciaMonto({ monto: 480000, montoUsd: 100, moneda: 'VES' }, { tasasVigentes: [] })).toBeNull();
  });

  it('con tasa explícita se usa esa tasa y no las vigentes', () => {
    const l = { monto: 5000, montoUsd: 100, moneda: 'VES' as const, tasa: 50 };
    expect(validarCoherenciaMonto(l, { tasasVigentes: vigentes })).toBeNull();
    expect(validarCoherenciaMonto({ ...l, monto: 5000 * (1 + TOLERANCIA_TASA_EXPLICITA * 3) }, { tasasVigentes: vigentes }))
      .toMatch(/no corresponde a la tasa indicada/);
  });
});

describe('tasasUsdVesVigentes y validarMontosDeLineas', () => {
  beforeEach(() => { bd.filas = []; bd.error = null; bd.lanza = false; bd.consultas = 0; });

  it('toma la última captura de cada fuente', async () => {
    bd.filas = [
      { fuente: 'BCV', tasa: 480, fecha: '2026-10-16' }, { fuente: 'Binance', tasa: '610.5', fecha: '2026-10-16' },
      { fuente: 'BCV', tasa: 470, fecha: '2026-10-15' },
    ];
    expect(await tasasUsdVesVigentes()).toEqual([480, 610.5]);
  });

  it('un error de lectura o una excepción devuelve vacío sin lanzar', async () => {
    bd.error = { message: 'boom' };
    expect(await tasasUsdVesVigentes()).toEqual([]);
    bd.error = null; bd.lanza = true;
    expect(await tasasUsdVesVigentes()).toEqual([]);
  });

  it('una línea en USD no consulta la tabla de tasas', async () => {
    expect(await validarMontosDeLineas([{ monto: 50, montoUsd: 50, moneda: 'USD' }])).toBeNull();
    expect(bd.consultas).toBe(0);
  });

  it('rechaza una línea en Bs fuera de rango y acepta la normal', async () => {
    bd.filas = [{ fuente: 'BCV', tasa: 480, fecha: '2026-10-16' }, { fuente: 'Binance', tasa: 600, fecha: '2026-10-16' }];
    expect(await validarMontosDeLineas([{ monto: 54000, montoUsd: 100, moneda: 'VES' }])).toBeNull();
    expect(await validarMontosDeLineas([{ monto: 540000, montoUsd: 100, moneda: 'VES' }])).toMatch(/Revisa los montos/);
  });

  it('sin tasas guardadas el pago en Bs pasa (se avisa en el log)', async () => {
    expect(await validarMontosDeLineas([{ monto: 540000, montoUsd: 100, moneda: 'VES' }])).toBeNull();
  });
});

describe('esquemas: tope y 2 decimales', () => {
  const pago = { proveedorId: U, bancaId: B, monto: 100, moneda: 'USD', montoUsd: 100, fecha: '2026-10-16' };
  const multi = {
    proveedorId: U, bancas: [{ bancaId: B, monto: 100, moneda: 'USD', montoUsd: 100 }], montoUsd: 100,
    fecha: '2026-10-16', items: [{ tipo: 'factura', id: F, montoUsd: 100 }],
  };

  it('el pago simple acepta valores normales y el clientRequestId opcional', () => {
    expect(registrarPagoSchema.safeParse(pago).success).toBe(true);
    expect(registrarPagoSchema.safeParse({ ...pago, clientRequestId: F }).success).toBe(true);
    expect(registrarPagoSchema.safeParse({ ...pago, clientRequestId: 'no-uuid' }).success).toBe(false);
  });

  it('rechaza más de 2 decimales y montos sobre el tope (monto y montoUsd)', () => {
    expect(registrarPagoSchema.safeParse({ ...pago, monto: 10.123 }).success).toBe(false);
    expect(registrarPagoSchema.safeParse({ ...pago, montoUsd: 10.005 }).success).toBe(false);
    expect(registrarPagoSchema.safeParse({ ...pago, montoUsd: MONTO_MAXIMO_USD + 1 }).success).toBe(false);
    expect(registrarPagoSchema.safeParse({ ...pago, monto: MONTO_MAXIMO_MONEDA_CUENTA + 1 }).success).toBe(false);
    expect(registrarPagoSchema.safeParse({ ...pago, montoUsd: MONTO_MAXIMO_USD, monto: MONTO_MAXIMO_USD }).success).toBe(true);
  });

  it('la tolerancia al flotante no rechaza sumas como 0.1 + 0.2', () => {
    expect(registrarPagoSchema.safeParse({ ...pago, monto: 0.1 + 0.2, montoUsd: 0.1 + 0.2 }).success).toBe(true);
  });

  it('el pago combinado aplica el tope y los decimales a bancas, ítems y total', () => {
    expect(registrarPagoMultipleSchema.safeParse(multi).success).toBe(true);
    expect(registrarPagoMultipleSchema.safeParse({ ...multi, bancas: [{ ...multi.bancas[0], monto: 1.234 }] }).success).toBe(false);
    expect(registrarPagoMultipleSchema.safeParse({ ...multi, items: [{ ...multi.items[0], montoUsd: 99.999 }] }).success).toBe(false);
    expect(registrarPagoMultipleSchema.safeParse({ ...multi, montoUsd: 2_000_000_000 }).success).toBe(false);
  });

  it('un cruce puro (montoUsd 0, sin bancas) sigue siendo válido', () => {
    const items = [{ tipo: 'factura', id: F, montoUsd: 100 }, { tipo: 'adelanto', id: B, montoUsd: 100 }];
    expect(registrarPagoMultipleSchema.safeParse({ ...multi, bancas: [], montoUsd: 0, items }).success).toBe(true);
  });

  it('el cobro combinado hereda los mismos límites y acepta clientRequestId', () => {
    const cobro = { ...multi, proveedorId: undefined, clienteId: U };
    expect(registrarCobroMultipleSchema.safeParse({ ...cobro, clientRequestId: F }).success).toBe(true);
    expect(registrarCobroMultipleSchema.safeParse({ ...cobro, montoUsd: 100.555 }).success).toBe(false);
  });
});
