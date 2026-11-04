import { describe, it, expect } from 'vitest';
import {
  ayudaSaldoPortal,
  fechaCorta,
  importeMovimiento,
  mensajeSaldo,
  resumenDocumentos,
  ultimoMovimiento,
} from '../../frontend/src/lib/portal-kpis';

describe('mensajeSaldo', () => {
  it('saldo cero es saldado para ambos tipos', () => {
    expect(mensajeSaldo('proveedor', 0).situacion).toBe('saldado');
    expect(mensajeSaldo('cliente', 0).situacion).toBe('saldado');
  });
  it('proveedor con saldo positivo: Pronoia le debe', () => {
    expect(mensajeSaldo('proveedor', 10)).toEqual({ texto: 'Pronoia te debe', situacion: 'a_favor' });
  });
  it('cliente con saldo positivo: el cliente debe', () => {
    expect(mensajeSaldo('cliente', 10)).toEqual({ texto: 'Le debes a Pronoia', situacion: 'por_pagar' });
  });
  it('cliente con saldo negativo: Pronoia le debe', () => {
    expect(mensajeSaldo('cliente', -5).situacion).toBe('a_favor');
  });
});

describe('importeMovimiento', () => {
  const base = { fecha: '2026-09-20', descripcion: 'x', cargo: 100, abono: 40 };
  it('factura y nota de débito usan el cargo', () => {
    expect(importeMovimiento({ ...base, tipo: 'factura' })).toBe(100);
    expect(importeMovimiento({ ...base, tipo: 'nota_debito' })).toBe(100);
  });
  it('pago, adelanto y nota de crédito usan el abono', () => {
    expect(importeMovimiento({ ...base, tipo: 'pago' })).toBe(40);
    expect(importeMovimiento({ ...base, tipo: 'nota_credito' })).toBe(40);
  });
  it('cruce usa el monto cruzado o 0', () => {
    expect(importeMovimiento({ ...base, tipo: 'cruce', montoCruzado: 7 })).toBe(7);
    expect(importeMovimiento({ ...base, tipo: 'cruce' })).toBe(0);
  });
});

describe('ultimoMovimiento', () => {
  it('devuelve null sin movimientos', () => {
    expect(ultimoMovimiento([])).toBeNull();
  });
  it('devuelve el de fecha más reciente aunque venga desordenado', () => {
    const r = ultimoMovimiento([{ fecha: '2026-09-20T10:00:00Z' }, { fecha: '2026-10-01' }, { fecha: '2026-09-25' }]);
    expect(r?.fecha).toBe('2026-10-01');
  });
});

describe('resumenDocumentos', () => {
  it('null si no hay datos (error de carga)', () => {
    expect(resumenDocumentos(null)).toBeNull();
  });
  it('cuenta cada tipo y el total', () => {
    expect(resumenDocumentos({ facturas: [1, 2], tickets: [1], comprobantes: [] })).toEqual({
      facturas: 2, tickets: 1, comprobantes: 0, total: 3,
    });
  });
});

describe('fechaCorta', () => {
  it('formatea dd/mm/aaaa sin zona horaria', () => {
    expect(fechaCorta('2026-09-05T23:30:00-04:00')).toBe('05/09/2026');
  });
  it('devuelve — si no es fecha', () => {
    expect(fechaCorta(null)).toBe('—');
    expect(fechaCorta('abc')).toBe('—');
  });
});

describe('ayudaSaldoPortal', () => {
  it('explica el saldo según el tipo de tercero y tiene versión neutra', () => {
    expect(ayudaSaldoPortal('proveedor')).toContain('Pronoia te debe');
    expect(ayudaSaldoPortal('cliente')).toContain('Le debes a Pronoia');
    expect(ayudaSaldoPortal(undefined)).toContain('quién debe a quién');
  });
});
