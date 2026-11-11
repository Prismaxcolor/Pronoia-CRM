import { describe, it, expect, vi } from 'vitest';

// Los esquemas validan comprobantes contra ENV.SUPABASE_URL: se fija para no depender del .env local.
vi.mock('../src/config/env.js', async importOriginal => {
  const real = await importOriginal<typeof import('../src/config/env.js')>();
  return { ...real, ENV: { ...real.ENV, SUPABASE_URL: 'https://x.supabase.co' } };
});
vi.mock('../src/config/supabase.js', () => ({ supabaseAdmin: { from: () => ({}), rpc: async () => ({ data: null, error: null }) } }));
vi.mock('../src/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, clienteIp: () => '' }));
import { registrarPagoMultipleSchema, itemPagoMultipleSchema } from '../src/schemas/pagos.js';
import { registrarCobroMultipleSchema } from '../src/schemas/cobros.js';
import { comprobantesPorBanca, todosLosComprobantes } from '../src/utils/comprobantes-banca.js';
import { repartirComprobantes } from '../src/services/pagos-pasos-service.js';

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FOTO = (n: number) => `https://x.supabase.co/storage/v1/object/public/comprobantes/foto-${n}.jpg`;
const banca = (n: number, montoUsd: number, extra: Record<string, unknown> = {}) =>
  ({ bancaId: UUID(n), monto: montoUsd, moneda: 'USD' as const, montoUsd, ...extra });

const pago = (parcial: Record<string, unknown>) =>
  registrarPagoMultipleSchema.safeParse({ proveedorId: UUID(9), fecha: '2026-11-10', bancas: [], montoUsd: 0, items: [], ...parcial });
const cobro = (parcial: Record<string, unknown>) =>
  registrarCobroMultipleSchema.safeParse({ clienteId: UUID(9), fecha: '2026-11-10', bancas: [], montoUsd: 0, items: [], ...parcial });

describe('comprobante propio por banca (schemas)', () => {
  it('pago: cada banca puede traer sus comprobantes además del general', () => {
    const r = pago({
      bancas: [banca(1, 60, { comprobantes: [FOTO(1)] }), banca(2, 40, { comprobantes: [FOTO(2), FOTO(3)] })], montoUsd: 100,
      items: [{ tipo: 'factura', id: UUID(5), montoUsd: 100 }], comprobantes: [FOTO(9)],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.bancas.map(b => b.comprobantes)).toEqual([[FOTO(1)], [FOTO(2), FOTO(3)]]);
      expect(r.data.comprobantes).toEqual([FOTO(9)]);
    }
  });

  it('pago: sin comprobantes por banca sigue valiendo (compatibilidad) y quedan en lista vacía', () => {
    const r = pago({ bancas: [banca(1, 100)], montoUsd: 100, items: [{ tipo: 'factura', id: UUID(5), montoUsd: 100 }], comprobantes: [FOTO(9)] });
    expect(r.success && r.data.bancas[0].comprobantes).toEqual([]);
  });

  it('pago: rechaza un comprobante de banca que no es del bucket del sistema', () => {
    const r = pago({
      bancas: [banca(1, 100, { comprobantes: ['https://malo.example.com/x.jpg'] })], montoUsd: 100,
      items: [{ tipo: 'factura', id: UUID(5), montoUsd: 100 }],
    });
    expect(r.success).toBe(false);
  });

  it('cobro: también acepta comprobantes por banca', () => {
    const r = cobro({
      bancas: [banca(1, 30, { comprobantes: [FOTO(1)] }), banca(2, 70)], montoUsd: 100,
      items: [{ tipo: 'factura', id: UUID(5), montoUsd: 100 }],
    });
    expect(r.success && r.data.bancas.map(b => b.comprobantes)).toEqual([[FOTO(1)], []]);
  });
});

describe('factura de total 0: ítem con monto 0', () => {
  const cero = { tipo: 'factura', id: UUID(5), montoUsd: 0 };

  it('pago: una factura con monto 0 es un cruce puro válido (sin bancas ni efectivo)', () => {
    expect(pago({ items: [cero] }).success).toBe(true);
  });

  it('cobro: igual', () => {
    expect(cobro({ items: [cero] }).success).toBe(true);
  });

  it('se puede combinar con otra factura con saldo y banca', () => {
    const r = pago({ bancas: [banca(1, 50)], montoUsd: 50, items: [cero, { tipo: 'factura', id: UUID(6), montoUsd: 50 }] });
    expect(r.success).toBe(true);
  });

  it('notas y adelantos siguen exigiendo monto mayor a 0', () => {
    for (const tipo of ['nota_debito', 'nota_credito', 'adelanto']) {
      expect(pago({ items: [{ tipo, id: UUID(7), montoUsd: 0 }] }).success).toBe(false);
      expect(cobro({ items: [{ tipo, id: UUID(7), montoUsd: 0 }] }).success).toBe(false);
    }
  });

  it('un monto negativo se rechaza también en una factura', () => {
    expect(pago({ items: [{ ...cero, montoUsd: -1 }] }).success).toBe(false);
  });

  it('el pago con monto 0 sin ningún ítem sigue sin tener nada que registrar', () => {
    expect(pago({}).success).toBe(false);
  });

  it('la edición de operaciones conserva su regla: ítems con monto mayor a 0', () => {
    expect(itemPagoMultipleSchema.safeParse(cero).success).toBe(false);
  });
});

describe('comprobantesPorBanca / todosLosComprobantes', () => {
  it('omite las bancas sin comprobantes y quita repetidos', () => {
    expect(comprobantesPorBanca([
      { bancaId: 'a', comprobantes: ['x', 'x', 'y'] }, { bancaId: 'b', comprobantes: [] }, { bancaId: 'c' },
    ])).toEqual([{ bancaId: 'a', comprobantes: ['x', 'y'] }]);
  });

  it('junta generales y de cada banca sin repetir, generales primero', () => {
    expect(todosLosComprobantes(['g1', 'x'], [{ bancaId: 'a', comprobantes: ['x', 'y'] }, { bancaId: 'b' }])).toEqual(['g1', 'x', 'y']);
  });
});

describe('repartirComprobantes (movimiento de cada banca)', () => {
  const movs = [
    { id: 'm1', banca_origen_id: 'A', subtipo: 'pago' },
    { id: 'm2', banca_origen_id: 'B', subtipo: 'adelanto' },
    { id: 'm3', banca_origen_id: 'B', subtipo: 'pago' },
  ];

  it('cada banca recibe los suyos en su movimiento y los generales van al principal', () => {
    const r = repartirComprobantes(movs, 'm1', ['g'], [{ bancaId: 'A', comprobantes: ['a1'] }, { bancaId: 'B', comprobantes: ['b1'] }]);
    expect(r).toEqual([
      { movimientoId: 'm1', comprobantes: ['a1', 'g'] },
      { movimientoId: 'm3', comprobantes: ['b1'] }, // el «pago» antes que el adelanto de la misma cuenta
    ]);
  });

  it('sin comprobantes por banca todo va al principal, como siempre', () => {
    expect(repartirComprobantes([], 'm1', ['g1', 'g2'], [])).toEqual([{ movimientoId: 'm1', comprobantes: ['g1', 'g2'] }]);
  });

  it('si la cuenta solo tiene adelanto, ese movimiento recibe sus comprobantes', () => {
    const r = repartirComprobantes([{ id: 'm9', banca_origen_id: 'C', subtipo: 'adelanto' }], null, [], [{ bancaId: 'C', comprobantes: ['c1'] }]);
    expect(r).toEqual([{ movimientoId: 'm9', comprobantes: ['c1'] }]);
  });

  it('una banca sin movimiento se omite y no hay principal ni generales: nada que guardar', () => {
    expect(repartirComprobantes(movs, null, [], [{ bancaId: 'Z', comprobantes: ['z'] }])).toEqual([]);
  });

  it('sin repetidos cuando el general coincide con uno de la banca principal', () => {
    expect(repartirComprobantes(movs, 'm1', ['a1'], [{ bancaId: 'A', comprobantes: ['a1'] }])).toEqual([{ movimientoId: 'm1', comprobantes: ['a1'] }]);
  });
});
