import { describe, it, expect } from 'vitest';
import { montoEnBs, planificarDesembolso } from '../src/utils/nomina-desembolso';
import type { CuentaWallet } from '../src/utils/nomina-pago';

const USD: CuentaWallet = { id: 'u', nombre: 'CAJA CHICA', moneda: 'USD', archivada: false };
const VES: CuentaWallet = { id: 'v', nombre: 'CAJA BS', moneda: 'VES', archivada: false };
const base = { montoUsd: 100, tasaBs: null, comisionDisponible: true };

describe('montoEnBs', () => {
  it('USD x tasa al centavo', () => {
    expect(montoEnBs(100, 40)).toBe(4000);
    expect(montoEnBs(10.01, 36.4567)).toBe(364.93);
    expect(montoEnBs(0.1, 3)).toBe(0.3);
  });
});

describe('planificarDesembolso', () => {
  it('cuenta en USD: sale el monto del préstamo, sin tasa ni comisión', () => {
    expect(planificarDesembolso({ ...base, cuenta: USD })).toEqual({ montoCuenta: 100, tasaBs: null, llevaComision: null });
  });

  it('cuenta en USD ignora una tasa que llegue de más', () => {
    expect(planificarDesembolso({ ...base, cuenta: USD, tasaBs: 40 })).toMatchObject({ montoCuenta: 100, tasaBs: null });
  });

  it('cuenta en Bs: sale monto x tasa, con la tasa usada y la comisión elegida', () => {
    expect(planificarDesembolso({ ...base, cuenta: VES, tasaBs: 40, llevaComision: false })).toEqual({ montoCuenta: 4000, tasaBs: 40, llevaComision: false });
    expect(planificarDesembolso({ ...base, cuenta: VES, tasaBs: 40, llevaComision: true })).toMatchObject({ llevaComision: true });
  });

  it('cuenta en Bs sin tasa: se pide la tasa (400)', () => {
    const r = planificarDesembolso({ ...base, cuenta: VES, llevaComision: false });
    expect(r).toMatchObject({ codigo: 400 });
    expect('error' in r && r.error).toMatch(/tasa/i);
  });

  it('cuenta en Bs: la comisión Sí/No es obligatoria si la migración de comisión está aplicada', () => {
    const r = planificarDesembolso({ ...base, cuenta: VES, tasaBs: 40 });
    expect(r).toMatchObject({ codigo: 400 });
    expect('error' in r && r.error).toMatch(/comisión/i);
  });

  it('cuenta en Bs sin la migración de comisión: sin comisión (null); pedir comisión Sí da 503', () => {
    expect(planificarDesembolso({ ...base, cuenta: VES, tasaBs: 40, comisionDisponible: false })).toMatchObject({ llevaComision: null });
    expect(planificarDesembolso({ ...base, cuenta: VES, tasaBs: 40, llevaComision: true, comisionDisponible: false })).toMatchObject({ codigo: 503 });
  });

  it('comisión en una cuenta USD: solo se rechaza el Sí', () => {
    expect(planificarDesembolso({ ...base, cuenta: USD, llevaComision: true })).toMatchObject({ codigo: 400 });
    expect(planificarDesembolso({ ...base, cuenta: USD, llevaComision: false })).toMatchObject({ llevaComision: null });
  });

  it('cuenta inexistente, archivada o en otra moneda: 400', () => {
    expect(planificarDesembolso({ ...base, cuenta: undefined })).toMatchObject({ codigo: 400 });
    expect(planificarDesembolso({ ...base, cuenta: { ...USD, archivada: true } })).toMatchObject({ codigo: 400 });
    const r = planificarDesembolso({ ...base, cuenta: { ...USD, moneda: 'EUR' } });
    expect(r).toMatchObject({ codigo: 400 });
    expect('error' in r && r.error).toMatch(/USD o en bolívares/i);
  });
});
