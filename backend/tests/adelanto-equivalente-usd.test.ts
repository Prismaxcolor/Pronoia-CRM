import { describe, it, expect, vi, beforeEach } from 'vitest';

const bd = vi.hoisted(() => ({ tasas: {} as Record<string, number | null>, filtros: [] as string[] }));
vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: {
    from: () => {
      let fuente = '';
      const c: Record<string, unknown> = {};
      c.select = () => c; c.order = () => c; c.limit = () => c;
      c.gt = (k: string, v: number) => { bd.filtros.push(`${k}>${v}`); return c; };
      c.eq = (k: string, v: string) => { if (k === 'fuente') fuente = v; return c; };
      c.then = (ok: (r: unknown) => unknown) =>
        Promise.resolve({ data: bd.tasas[fuente] ? [{ tasa: bd.tasas[fuente] }] : [], error: null }).then(ok);
      return c;
    },
  },
}));
vi.mock('../src/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { equivalenteUsdParaAdelanto, usdDeBs } from '../src/services/movimiento-adelanto-service.js';

const P = 'p1';
beforeEach(() => { bd.tasas = { Binance: 50, BCV: 40 }; });

describe('equivalenteUsdParaAdelanto', () => {
  it('un egreso con proveedor en Bs usa la tasa Binance', async () => {
    expect(await equivalenteUsdParaAdelanto({ tipo: 'egreso', proveedorId: P, moneda: 'VES', monto: 1000 })).toEqual({ montoUsd: 20 });
  });
  it('sin Binance cae a BCV', async () => {
    bd.tasas = { Binance: null, BCV: 40 };
    expect(await equivalenteUsdParaAdelanto({ tipo: 'egreso', proveedorId: P, moneda: 'VES', monto: 1000 })).toEqual({ montoUsd: 25 });
  });
  it('sin ninguna tasa rechaza en vez de contar Bs como USD', async () => {
    bd.tasas = {};
    expect(await equivalenteUsdParaAdelanto({ tipo: 'egreso', proveedorId: P, moneda: 'VES', monto: 1000 })).toMatchObject({ error: expect.stringMatching(/tasa de cambio/) });
  });
  it('en USD no hay nada que guardar; otras monedas se rechazan', async () => {
    expect(await equivalenteUsdParaAdelanto({ tipo: 'egreso', proveedorId: P, moneda: 'USD', monto: 10 })).toEqual({ montoUsd: null });
    expect(await equivalenteUsdParaAdelanto({ tipo: 'egreso', proveedorId: P, moneda: 'EUR', monto: 10 })).toMatchObject({ error: expect.any(String) });
  });
  it('un movimiento manual común no consulta ni convierte', async () => {
    expect(await equivalenteUsdParaAdelanto({ tipo: 'egreso', moneda: 'VES', monto: 1000 })).toEqual({ montoUsd: null });
  });
  it('solo considera tasas mayores a 0 (igual que la RPC SQL)', async () => {
    bd.filtros = [];
    await equivalenteUsdParaAdelanto({ tipo: 'egreso', proveedorId: P, moneda: 'VES', monto: 1000 });
    expect(bd.filtros).toContain('tasa>0');
  });
  it('redondea a centavos', () => {
    expect(usdDeBs(100, 3)).toBe(33.33);
    expect(usdDeBs(0.05, 10)).toBe(0.01);
  });
});
