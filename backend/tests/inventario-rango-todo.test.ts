import { describe, expect, it } from 'vitest';
import { MAX_DIAS_RANGO, resumenQuerySchema } from '../src/schemas/inventario-resumen.js';
import { pantallaQuerySchema } from '../src/schemas/inventario-pantalla.js';
import { composicionLoteQuerySchema } from '../src/schemas/lote-composicion.js';

const TODO = { desde: '2020-01-01', hasta: '2026-10-04' };

describe('periodo "Todo" (desde 2020-01-01) en inventario', () => {
  it('lo aceptan resumen, pantalla y composición de lote', () => {
    expect(resumenQuerySchema.safeParse(TODO).success).toBe(true);
    expect(pantallaQuerySchema.safeParse(TODO).success).toBe(true);
    expect(composicionLoteQuerySchema.safeParse(TODO).success).toBe(true);
  });

  it('sigue rechazando rangos de más de ~10 años, desde > hasta y fechas inexistentes', () => {
    expect(MAX_DIAS_RANGO).toBeGreaterThanOrEqual(3650);
    expect(resumenQuerySchema.safeParse({ desde: '2010-01-01', hasta: '2026-10-04' }).success).toBe(false);
    expect(resumenQuerySchema.safeParse({ desde: '2026-10-05', hasta: '2026-10-04' }).success).toBe(false);
    expect(resumenQuerySchema.safeParse({ desde: '2026-02-31', hasta: '2026-10-04' }).success).toBe(false);
  });
});
