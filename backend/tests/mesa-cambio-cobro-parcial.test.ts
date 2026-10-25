import { describe, it, expect, vi } from 'vitest';

// Los esquemas validan comprobantes contra ENV.SUPABASE_URL: se fija para no depender del .env local.
vi.mock('../src/config/env.js', async importOriginal => {
  const real = await importOriginal<typeof import('../src/config/env.js')>();
  return { ...real, ENV: { ...real.ENV, SUPABASE_URL: 'https://x.supabase.co' } };
});

import { planificarCobroMesa } from '../src/utils/mesa-cambio-cobro.js';
import { completarTransferenciaMesaSchema } from '../src/schemas/transferencia-mesa.js';

const URL_OK = 'https://x.supabase.co/storage/v1/object/public/comprobantes/a.png';

describe('planificarCobroMesa (espejo de cobrar_transferencia_mesa_cambio)', () => {
  const base = { neto: 980, cobrado: 0, cargoUsd: 1000, usdYaCobrado: 0 };

  it('sin monto cobra todo lo pendiente y completa; el COBRO iguala al CARGO', () => {
    expect(planificarCobroMesa({ ...base, monto: null })).toEqual({ ok: true, cobro: 980, pendiente: 0, completa: true, usdCobro: 1000 });
  });

  it('cobro parcial proporcional al neto: 490 de 980 salda la mitad del CARGO', () => {
    expect(planificarCobroMesa({ ...base, monto: 490 })).toEqual({ ok: true, cobro: 490, pendiente: 490, completa: false, usdCobro: 500 });
  });

  it('el cobro que completa toma el resto exacto del CARGO (sin deriva de redondeo)', () => {
    const primero = planificarCobroMesa({ neto: 100, cobrado: 0, cargoUsd: 100, usdYaCobrado: 0, monto: 33.33 });
    expect(primero).toMatchObject({ ok: true, completa: false, usdCobro: 33.33 });
    const segundo = planificarCobroMesa({ neto: 100, cobrado: 33.33, cargoUsd: 100, usdYaCobrado: 33.33, monto: null });
    expect(segundo).toEqual({ ok: true, cobro: 66.67, pendiente: 0, completa: true, usdCobro: 66.67 });
  });

  it('tres cobros parciales suman exactamente el CARGO y el neto', () => {
    let cobrado = 0;
    let usd = 0;
    for (const monto of [100, 250.55, null]) {
      const p = planificarCobroMesa({ neto: 700.55, cobrado, cargoUsd: 710, usdYaCobrado: usd, monto });
      if (!p.ok) throw new Error(p.error);
      cobrado = Math.round((cobrado + p.cobro) * 100) / 100;
      usd = Math.round((usd + p.usdCobro) * 100) / 100;
    }
    expect(cobrado).toBe(700.55);
    expect(usd).toBe(710);
  });

  it('rechaza montos no positivos, mayores al pendiente y cobros que no mueven USD', () => {
    expect(planificarCobroMesa({ ...base, monto: 0 })).toMatchObject({ ok: false });
    expect(planificarCobroMesa({ ...base, monto: -5 })).toMatchObject({ ok: false });
    expect(planificarCobroMesa({ ...base, cobrado: 900, usdYaCobrado: 918.37, monto: 100 })).toMatchObject({ ok: false, error: expect.stringContaining('pendiente') });
    expect(planificarCobroMesa({ neto: 1_000_000, cobrado: 0, cargoUsd: 1, usdYaCobrado: 0, monto: 1 })).toMatchObject({ ok: false });
  });

  it('una transferencia ya cobrada por completo no admite otro cobro', () => {
    expect(planificarCobroMesa({ ...base, cobrado: 980, usdYaCobrado: 1000, monto: null })).toMatchObject({ ok: false });
  });
});

describe('completarTransferenciaMesaSchema', () => {
  it('el cuerpo vacío sigue siendo válido (cobro total, sin foto)', () => {
    expect(completarTransferenciaMesaSchema.parse({})).toEqual({ montoCobrado: null, pendienteEsperado: null, comprobantes: [], observacion: null });
  });

  it('la observación se recorta, es opcional y admite hasta 300 caracteres', () => {
    expect(completarTransferenciaMesaSchema.parse({ observacion: '  Entregó en efectivo  ' }).observacion).toBe('Entregó en efectivo');
    expect(completarTransferenciaMesaSchema.parse({ observacion: '   ' }).observacion).toBeNull();
    expect(completarTransferenciaMesaSchema.safeParse({ observacion: 'a'.repeat(300) }).success).toBe(true);
    expect(completarTransferenciaMesaSchema.safeParse({ observacion: 'a'.repeat(301) }).success).toBe(false);
  });

  it('acepta cobro parcial con foto y el pendiente que vio el usuario', () => {
    const r = completarTransferenciaMesaSchema.parse({ montoCobrado: 490.5, pendienteEsperado: 980, comprobantes: [URL_OK] });
    expect(r).toMatchObject({ montoCobrado: 490.5, pendienteEsperado: 980, comprobantes: [URL_OK] });
  });

  it('rechaza monto cero, negativo o con más de 2 decimales', () => {
    for (const montoCobrado of [0, -1, 10.123]) {
      expect(completarTransferenciaMesaSchema.safeParse({ montoCobrado }).success).toBe(false);
    }
  });

  it('rechaza comprobantes que no son del almacenamiento del sistema y más de 10', () => {
    expect(completarTransferenciaMesaSchema.safeParse({ comprobantes: ['https://evil.example/a.png'] }).success).toBe(false);
    expect(completarTransferenciaMesaSchema.safeParse({ comprobantes: Array(11).fill(URL_OK) }).success).toBe(false);
  });
});
