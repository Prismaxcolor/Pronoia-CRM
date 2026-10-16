import { describe, it, expect } from 'vitest';
import { resumenComprobante, type TipoItemComprobante } from '../src/utils/comprobante-resumen';
import { calcularCruce } from '../../frontend/src/lib/cruce';

const it_ = (tipo: TipoItemComprobante, montoUsd: number) => ({ tipo, montoUsd });
const claves = (filas: ReturnType<typeof resumenComprobante>) => filas.map(x => x.clave);
const monto = (filas: ReturnType<typeof resumenComprobante>, clave: string) => filas.find(x => x.clave === clave)?.montoUsd;

describe('resumenComprobante', () => {
  it('orden: total de facturas, adelantos / N/C / N/D, saldo pendiente y al final lo pagado', () => {
    const r = resumenComprobante([it_('factura', 100), it_('adelanto', 30), it_('nota_credito', 10), it_('nota_debito', 5)], 65, true);
    expect(claves(r)).toEqual(['totalFacturas', 'notasDebito', 'adelantos', 'notasCredito', 'saldoPendiente', 'pagado']);
    expect(monto(r, 'totalFacturas')).toBe(100);
    expect(monto(r, 'saldoPendiente')).toBe(65);
    expect(monto(r, 'pagado')).toBe(65);
    expect(r.find(x => x.clave === 'adelantos')?.signo).toBe('-');
    expect(r.find(x => x.clave === 'notasDebito')?.signo).toBe('+');
  });

  it('solo muestra los ajustes que se aplicaron', () => {
    expect(claves(resumenComprobante([it_('factura', 50)], 50, true))).toEqual(['totalFacturas', 'saldoPendiente', 'pagado']);
  });

  it('cruce puro: saldo pendiente 0 y pagado 0', () => {
    const r = resumenComprobante([it_('factura', 80), it_('adelanto', 80)], 0, true);
    expect(monto(r, 'saldoPendiente')).toBe(0);
    expect(monto(r, 'pagado')).toBe(0);
  });

  it('cliente: etiqueta anticipos en vez de adelantos', () => {
    const r = resumenComprobante([it_('factura', 80), it_('adelanto', 20)], 60, false);
    expect(r.find(x => x.clave === 'adelantos')?.etiqueta).toBe('Anticipos aplicados');
  });

  it('sin desglose (pagos anteriores) solo queda lo pagado', () => {
    expect(resumenComprobante([], 42.5, true)).toEqual([{ clave: 'pagado', etiqueta: 'Pagado', montoUsd: 42.5, signo: '' }]);
  });

  it('el saldo coincide con el efectivo de calcularCruce (una sola regla)', () => {
    const casos = [
      [it_('factura', 100), it_('adelanto', 60), it_('nota_credito', 10), it_('nota_debito', 5)],
      [it_('factura', 33.33), it_('adelanto', 33.32)],
      [it_('factura', 0.1), it_('factura', 0.2)],
      [it_('factura', 50), it_('adelanto', 50)],
    ];
    for (const items of casos) {
      expect(monto(resumenComprobante(items, 0, true), 'saldoPendiente')).toBe(calcularCruce(items).efectivo);
    }
  });

  it('pago parcial: total real de la factura, saldo pendiente tras la operación y pagado al final', () => {
    // Factura de 1000, se pagan 400 en esta operación (monto_pagado acumulado = 400)
    const r = resumenComprobante([it_('factura', 400)], 400, true, [{ total: 1000, montoPagado: 400 }]);
    expect(claves(r)).toEqual(['totalFacturas', 'saldoPendiente', 'pagado']);
    expect(monto(r, 'totalFacturas')).toBe(1000);
    expect(monto(r, 'saldoPendiente')).toBe(600);
    expect(monto(r, 'pagado')).toBe(400);
  });

  it('segundo pago: el saldo descuenta lo pagado en operaciones anteriores', () => {
    const r = resumenComprobante([it_('factura', 300)], 300, true, [{ total: 1000, montoPagado: 700 }]);
    expect(monto(r, 'totalFacturas')).toBe(1000);
    expect(monto(r, 'saldoPendiente')).toBe(300);
    expect(monto(r, 'pagado')).toBe(300);
  });

  it('varias facturas: suma el total real de cada una y el saldo de cada una', () => {
    const r = resumenComprobante(
      [it_('factura', 500), it_('factura', 200), it_('adelanto', 100)],
      600,
      true,
      [{ total: 500, montoPagado: 500 }, { total: 800, montoPagado: 300 }]
    );
    expect(monto(r, 'totalFacturas')).toBe(1300);
    expect(monto(r, 'saldoPendiente')).toBe(500);
    expect(monto(r, 'adelantos')).toBe(100);
  });

  it('factura saldada del todo: saldo pendiente 0', () => {
    const r = resumenComprobante([it_('factura', 1000)], 1000, true, [{ total: 1000, montoPagado: 1000 }]);
    expect(monto(r, 'saldoPendiente')).toBe(0);
  });
});
