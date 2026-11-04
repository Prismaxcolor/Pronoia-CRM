import { describe, it, expect } from 'vitest';
import {
  aTasaUsd, textoEquivalenteTotal, textoLineaEquivalente,
} from '../../frontend/src/features/cochinito/equivalente-usd';
import {
  llevaDeOpcion, ofrecerComision, planDeComision,
} from '../../frontend/src/features/cochinito/comision-formulario';
import { esCargoDeComision, tieneComision } from '../../frontend/src/features/cochinito/detalle-movimiento';

describe('aTasaUsd', () => {
  it('convierte una tasa del servicio a tasa + fecha', () => {
    expect(aTasaUsd({ tasa: 600, fecha: '2026-10-11T15:00:00Z' })).toEqual({ tasa: 600, fecha: '2026-10-11T15:00:00Z' });
  });

  it('una tasa ausente, cero o inválida es null (no se inventa)', () => {
    expect(aTasaUsd(null)).toBeNull();
    expect(aTasaUsd({ tasa: 0, fecha: '2026-10-11T15:00:00Z' })).toBeNull();
    expect(aTasaUsd({ tasa: Number.NaN, fecha: '2026-10-11T15:00:00Z' })).toBeNull();
  });
});

describe('textoLineaEquivalente', () => {
  it('con tasa: equivalente, fuente, tasa usada y fecha', () => {
    const t = textoLineaEquivalente({ fuente: 'Binance', tasa: 600, fecha: '2026-10-11T15:00:00Z', usd: 10 });
    expect(t).toContain('USD 10,00');
    expect(t).toContain('Binance');
    expect(t).toContain('600,00');
    expect(t).toContain('11/10/2026');
  });

  it('sin tasa: lo dice y no muestra un número', () => {
    const t = textoLineaEquivalente({ fuente: 'BCV', tasa: null, fecha: null, usd: null });
    expect(t).toContain('BCV');
    expect(t).toContain('no disponible');
    expect(t).not.toMatch(/USD \d/);
  });
});

describe('textoEquivalenteTotal', () => {
  it('muestra los USD a tasa Binance con su fecha', () => {
    const t = textoEquivalenteTotal(1200, { tasa: 600, fecha: '2026-10-11T15:00:00Z' });
    expect(t).toContain('USD 2,00');
    expect(t).toContain('Binance');
  });

  it('sin tasa Binance lo dice', () => {
    expect(textoEquivalenteTotal(1200, null)).toContain('no disponible');
  });
});

describe('formulario de comisión bancaria', () => {
  it('Sí / No / sin elegir', () => {
    expect(llevaDeOpcion('si')).toBe(true);
    expect(llevaDeOpcion('no')).toBe(false);
    expect(llevaDeOpcion('')).toBeNull();
  });

  it('se ofrece solo con la migración, en salidas desde Bs y sin mesa de cambio', () => {
    const base = { disponible: true, tipo: 'egreso' as const, moneda: 'VES', mesaActiva: false };
    expect(ofrecerComision(base)).toBe(true);
    expect(ofrecerComision({ ...base, tipo: 'transferencia' })).toBe(true);
    expect(ofrecerComision({ ...base, disponible: false })).toBe(false);
    expect(ofrecerComision({ ...base, tipo: 'ingreso' })).toBe(false);
    expect(ofrecerComision({ ...base, moneda: 'USD' })).toBe(false);
    expect(ofrecerComision({ ...base, mesaActiva: true })).toBe(false);
  });

  it('un tipo sin elegir no ofrece la comisión', () => {
    expect(ofrecerComision({ disponible: true, tipo: '', moneda: 'VES', mesaActiva: false })).toBe(false);
  });

  it('si no se ofrece, el plan no pide nada', () => {
    expect(planDeComision({ ofrecida: false, tipo: 'egreso', moneda: 'VES', monto: 100, opcion: '', saldo: 1 }))
      .toEqual({ ok: true, aplica: false, comision: 0, totalDebitado: 100 });
  });

  it('si se ofrece, exige elegir y calcula el total', () => {
    const e = { ofrecida: true, tipo: 'egreso' as const, moneda: 'VES', monto: 10000, saldo: 50000 };
    expect(planDeComision({ ...e, opcion: '' })).toMatchObject({ ok: false });
    expect(planDeComision({ ...e, opcion: 'si' })).toMatchObject({ ok: true, comision: 30, totalDebitado: 10030 });
    expect(planDeComision({ ...e, opcion: 'no' })).toMatchObject({ ok: true, comision: 0, totalDebitado: 10000 });
  });
});

describe('movimientos con comisión', () => {
  it('reconoce el movimiento principal y su cargo', () => {
    expect(tieneComision({ comisionBancaria: 30 })).toBe(true);
    expect(tieneComision({ comisionBancaria: null })).toBe(false);
    expect(tieneComision({})).toBe(false);
    expect(esCargoDeComision({ comisionDeId: 'm-1' })).toBe(true);
    expect(esCargoDeComision({ comisionDeId: null })).toBe(false);
    expect(esCargoDeComision({})).toBe(false);
  });
});
