import { describe, it, expect } from 'vitest';
import { registrarPagoMultipleSchema } from '../src/schemas/pagos.js';
import { registrarCobroMultipleSchema } from '../src/schemas/cobros.js';

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const banca = (montoUsd: number) => ({ bancaId: UUID(1), monto: montoUsd, moneda: 'USD' as const, montoUsd });

const pago = (parcial: Record<string, unknown>) =>
  registrarPagoMultipleSchema.safeParse({
    proveedorId: UUID(9), fecha: '2026-10-03', bancas: [], montoUsd: 0, items: [], ...parcial,
  });

describe('registrarPagoMultipleSchema con cruce', () => {
  it('acepta un cruce puro: factura cubierta por un adelanto, sin bancas ni efectivo', () => {
    const r = pago({
      items: [
        { tipo: 'factura', id: UUID(2), montoUsd: 80 },
        { tipo: 'adelanto', id: UUID(3), montoUsd: 80 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('acepta factura - adelanto - NC + ND con efectivo por la diferencia', () => {
    const r = pago({
      bancas: [banca(35)], montoUsd: 35,
      items: [
        { tipo: 'factura', id: UUID(2), montoUsd: 100 },
        { tipo: 'nota_debito', id: UUID(4), montoUsd: 5 },
        { tipo: 'adelanto', id: UUID(3), montoUsd: 60 },
        { tipo: 'nota_credito', id: UUID(5), montoUsd: 10 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rechaza total 0 sin ningún ítem (no hay nada que registrar)', () => {
    expect(pago({}).success).toBe(false);
  });

  it('rechaza efectivo mayor a 0 sin bancas', () => {
    const r = pago({ montoUsd: 20, items: [{ tipo: 'factura', id: UUID(2), montoUsd: 20 }] });
    expect(r.success).toBe(false);
  });

  it('rechaza adelantos que superan las facturas seleccionadas', () => {
    const r = pago({
      items: [
        { tipo: 'factura', id: UUID(2), montoUsd: 50 },
        { tipo: 'adelanto', id: UUID(3), montoUsd: 60 },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some(i => /superan/.test(i.message))).toBe(true);
  });

  it('rechaza un total menor al efectivo requerido', () => {
    const r = pago({
      bancas: [banca(10)], montoUsd: 10,
      items: [{ tipo: 'factura', id: UUID(2), montoUsd: 50 }, { tipo: 'adelanto', id: UUID(3), montoUsd: 20 }],
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some(i => /menor/.test(i.message))).toBe(true);
  });

  it('rechaza total negativo y tipos de ítem desconocidos', () => {
    expect(pago({ montoUsd: -1 }).success).toBe(false);
    expect(pago({ items: [{ tipo: 'otro', id: UUID(2), montoUsd: 1 }] }).success).toBe(false);
  });

  it('el pago normal con exceso (adelanto nuevo) sigue válido', () => {
    const r = pago({ bancas: [banca(120)], montoUsd: 120, items: [{ tipo: 'factura', id: UUID(2), montoUsd: 100 }] });
    expect(r.success).toBe(true);
  });
});

describe('registrarCobroMultipleSchema con cruce', () => {
  it('acepta un cruce puro con un anticipo del cliente', () => {
    const r = registrarCobroMultipleSchema.safeParse({
      clienteId: UUID(9), fecha: '2026-10-03', bancas: [], montoUsd: 0,
      items: [{ tipo: 'factura', id: UUID(2), montoUsd: 40 }, { tipo: 'adelanto', id: UUID(3), montoUsd: 40 }],
    });
    expect(r.success).toBe(true);
  });

  it('rechaza un cobro sin ítems ni bancas', () => {
    const r = registrarCobroMultipleSchema.safeParse({ clienteId: UUID(9), fecha: '2026-10-03', bancas: [], montoUsd: 0, items: [] });
    expect(r.success).toBe(false);
  });
});
