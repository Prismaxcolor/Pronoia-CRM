import { describe, it, expect } from 'vitest';
import { pantallaQuerySchema } from '../src/schemas/inventario-pantalla.js';
import { resumenQuerySchema } from '../src/schemas/inventario-resumen.js';

describe('parámetro al (saldo a una fecha)', () => {
  it.each([
    ['pantalla', pantallaQuerySchema],
    ['resumen', resumenQuerySchema],
  ])('%s: acepta una fecha pasada y la devuelve', (_n, esquema) => {
    const r = esquema.safeParse({ al: '2026-10-01' });
    expect(r.success).toBe(true);
    expect(r.success && (r.data as { al?: string }).al).toBe('2026-10-01');
  });

  it.each([
    ['pantalla', pantallaQuerySchema],
    ['resumen', resumenQuerySchema],
  ])('%s: rechaza formato inválido, fechas inexistentes y fechas futuras', (_n, esquema) => {
    expect(esquema.safeParse({ al: '01-10-2026' }).success).toBe(false);
    expect(esquema.safeParse({ al: '2026-02-31' }).success).toBe(false);
    const futura = esquema.safeParse({ al: '2999-01-01' });
    expect(futura.success).toBe(false);
    expect(!futura.success && futura.error.issues[0].message).toMatch(/futura/i);
  });

  it('es opcional y convive con desde/hasta', () => {
    expect(pantallaQuerySchema.safeParse({}).success).toBe(true);
    expect(pantallaQuerySchema.safeParse({ desde: '2026-09-01', hasta: '2026-10-01', al: '2026-10-01' }).success).toBe(true);
  });
});
