import { describe, it, expect } from 'vitest';
import { crearTransferenciaMesaSchema } from '../src/schemas/transferencia-mesa.js';
import { crearMovimientoSchema } from '../src/schemas/cochinito.js';
import { esFechaReal } from '../src/utils/fecha-calendario.js';
import { tieneMaximoDosDecimales } from '../src/utils/importe-centavos.js';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';

const valido = {
  cambistaId: U1, bancaId: U2, bancaDestinoId: U3, monto: 100, fecha: '2026-10-11',
};
const mensajes = (r: { success: boolean; error?: { issues: Array<{ message: string }> } }): string[] =>
  r.success ? [] : (r.error?.issues ?? []).map(i => i.message);

describe('esFechaReal / tieneMaximoDosDecimales', () => {
  it('rechaza fechas que no existen', () => {
    expect(esFechaReal('2026-10-11')).toBe(true);
    expect(esFechaReal('2024-02-29')).toBe(true);
    expect(esFechaReal('2026-02-31')).toBe(false);
    expect(esFechaReal('2026-13-01')).toBe(false);
    expect(esFechaReal('26-1-1')).toBe(false);
  });

  it('acepta centavos y rechaza fracciones de centavo', () => {
    expect(tieneMaximoDosDecimales(10)).toBe(true);
    expect(tieneMaximoDosDecimales(10.25)).toBe(true);
    expect(tieneMaximoDosDecimales(0.1 + 0.2)).toBe(true);
    expect(tieneMaximoDosDecimales(1234567.89)).toBe(true);
    expect(tieneMaximoDosDecimales(0.004)).toBe(false);
    expect(tieneMaximoDosDecimales(10.005)).toBe(false);
    expect(tieneMaximoDosDecimales(Number.NaN)).toBe(false);
  });
});

describe('crearTransferenciaMesaSchema', () => {
  it('acepta una transferencia valida', () => {
    expect(crearTransferenciaMesaSchema.safeParse(valido).success).toBe(true);
  });

  it('rechaza mas de 2 decimales en monto, montoDestino, montoUsd y comision por monto', () => {
    for (const campo of ['monto', 'montoDestino', 'montoUsd']) {
      const r = crearTransferenciaMesaSchema.safeParse({ ...valido, [campo]: 0.004 });
      expect(r.success, campo).toBe(false);
      expect(mensajes(r).join(' ')).toContain('2 decimales');
    }
    const c = crearTransferenciaMesaSchema.safeParse({ ...valido, comision: { modo: 'monto', valor: 1.005 } });
    expect(c.success).toBe(false);
  });

  it('rechaza una fecha inexistente con mensaje claro', () => {
    const r = crearTransferenciaMesaSchema.safeParse({ ...valido, fecha: '2026-02-31' });
    expect(r.success).toBe(false);
    expect(mensajes(r)).toContain('La fecha no existe en el calendario.');
  });

  it('acepta clientRequestId opcional y rechaza uno que no es UUID', () => {
    expect(crearTransferenciaMesaSchema.safeParse({ ...valido, clientRequestId: U1 }).success).toBe(true);
    expect(crearTransferenciaMesaSchema.safeParse({ ...valido, clientRequestId: 'abc' }).success).toBe(false);
  });
});

describe('crearMovimientoSchema', () => {
  const mov = { tipo: 'egreso', bancaId: U2, monto: 10, moneda: 'USD', fecha: '2026-10-11' };

  it('rechaza una fecha inexistente', () => {
    const r = crearMovimientoSchema.safeParse({ ...mov, fecha: '2026-02-31' });
    expect(r.success).toBe(false);
    expect(mensajes(r)).toContain('La fecha no existe en el calendario.');
  });

  it('acepta clientRequestId opcional', () => {
    expect(crearMovimientoSchema.safeParse({ ...mov, clientRequestId: U1 }).success).toBe(true);
    expect(crearMovimientoSchema.safeParse(mov).success).toBe(true);
  });
});
