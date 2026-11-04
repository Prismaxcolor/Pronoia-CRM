import { describe, it, expect } from 'vitest';
import {
  construirDesembolso, cuentasDeDesembolso, desembolsoVacio, montoDeDesembolso, preguntaComisionDesembolso, validarDesembolso,
  type EstadoDesembolso,
} from '../../frontend/src/features/nomina/nomina-desembolso';
import type { Banca } from '../../shared/types/banca';

const banca = (id: string, moneda: string, saldo: number, extra: Partial<Banca> = {}): Banca =>
  ({ id, nombre: `Cuenta ${id}`, tipo: 'efectivo', saldo, moneda, descripcion: '', archivada: false, ...extra });

const USD1 = banca('usd1', 'USD', 500);
const USD_POCO = banca('usd-poco', 'USD', 50);
const VES1 = banca('ves1', 'VES', 100000);
const VES_POCO = banca('ves-poco', 'VES', 1000);
const bancas = [
  USD1, USD_POCO, VES1, VES_POCO, banca('usd-vieja', 'USD', 900, { archivada: true }), banca('usd-ver', 'USD', 900, { puedeEditar: false }), banca('eur', 'EUR', 900),
];
const estado = (extra: Partial<EstadoDesembolso> = {}): EstadoDesembolso => ({ ...desembolsoVacio('2026-10-10'), ...extra });

describe('cuentasDeDesembolso', () => {
  it('solo cuentas vigentes, editables y en USD o bolívares', () => {
    expect(cuentasDeDesembolso(bancas).map(b => b.id)).toEqual(['usd1', 'usd-poco', 'ves1', 'ves-poco']);
  });
});

describe('montoDeDesembolso', () => {
  it('cuenta USD: el monto del préstamo; cuenta Bs: monto x tasa al centavo; sin tasa válida, null', () => {
    expect(montoDeDesembolso(100, USD1, '')).toBe(100);
    expect(montoDeDesembolso(100, VES1, '40')).toBe(4000);
    expect(montoDeDesembolso(10.01, VES1, '36,4567')).toBe(364.93);
    expect(montoDeDesembolso(100, VES1, '')).toBeNull();
    expect(montoDeDesembolso(100, VES1, '0')).toBeNull();
    expect(montoDeDesembolso(100, VES1, 'abc')).toBeNull();
  });
});

describe('validarDesembolso', () => {
  const ok = (e: EstadoDesembolso, monto = 100, comision = true) => validarDesembolso(e, monto, bancas, comision);

  it('exige elegir una cuenta y una fecha', () => {
    expect(ok(estado())).toMatch(/cuenta/i);
    expect(ok(estado({ bancaId: 'usd1', fecha: '' }))).toMatch(/fecha/i);
  });

  it('cuenta en USD con saldo suficiente: listo; con saldo insuficiente se avisa', () => {
    expect(ok(estado({ bancaId: 'usd1' }))).toBeNull();
    expect(ok(estado({ bancaId: 'usd-poco' }), 100)).toMatch(/saldo insuficiente/i);
  });

  it('cuenta en Bs: pide la tasa y la respuesta Sí/No de la comisión', () => {
    expect(ok(estado({ bancaId: 'ves1' }))).toMatch(/tasa/i);
    expect(ok(estado({ bancaId: 'ves1', tasa: '40' }))).toMatch(/comisi/i);
    expect(ok(estado({ bancaId: 'ves1', tasa: '40', comision: 'no' }))).toBeNull();
  });

  it('cuenta en Bs: el saldo se compara con el monto convertido (y con la comisión si se elige Sí)', () => {
    expect(ok(estado({ bancaId: 'ves-poco', tasa: '40', comision: 'no' }))).toMatch(/saldo insuficiente/i);
    // 100 USD x 10 = 1000 Bs: alcanza sin comisión, pero con la comisión (mínimo 14 Bs) ya no
    expect(ok(estado({ bancaId: 'ves-poco', tasa: '10', comision: 'no' }))).toBeNull();
    expect(ok(estado({ bancaId: 'ves-poco', tasa: '10', comision: 'si' }))).not.toBeNull();
  });

  it('sin la migración de comisión no se pregunta por ella', () => {
    expect(preguntaComisionDesembolso(VES1, false)).toBe(false);
    expect(preguntaComisionDesembolso(VES1, true)).toBe(true);
    expect(preguntaComisionDesembolso(USD1, true)).toBe(false);
    expect(ok(estado({ bancaId: 'ves1', tasa: '40' }), 100, false)).toBeNull();
  });
});

describe('construirDesembolso', () => {
  it('cuenta USD: sin tasa ni comisión; referencia vacía = null; lleva los comprobantes', () => {
    expect(construirDesembolso(estado({ bancaId: 'usd1', referencia: '  ', tasa: '40' }), bancas, true, ['https://x/c.jpg'])).toEqual({
      bancaId: 'usd1', fecha: '2026-10-10', referencia: null, tasaBs: null, comprobantes: ['https://x/c.jpg'],
    });
  });

  it('cuenta Bs: manda la tasa (con coma o punto) y la comisión elegida', () => {
    expect(construirDesembolso(estado({ bancaId: 'ves1', tasa: '36,5', comision: 'si', referencia: ' R1 ' }), bancas, true, [])).toEqual({
      bancaId: 'ves1', fecha: '2026-10-10', referencia: 'R1', tasaBs: 36.5, llevaComision: true, comprobantes: [],
    });
    expect(construirDesembolso(estado({ bancaId: 'ves1', tasa: '40', comision: 'no' }), bancas, true, [])).toMatchObject({ llevaComision: false });
  });

  it('sin la migración de comisión, no manda llevaComision', () => {
    expect(construirDesembolso(estado({ bancaId: 'ves1', tasa: '40', comision: 'no' }), bancas, false, [])).not.toHaveProperty('llevaComision');
  });
});
