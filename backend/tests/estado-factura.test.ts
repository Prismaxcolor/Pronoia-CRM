import { describe, it, expect } from 'vitest';
import { derivarEstadoFactura, saldoFactura, tieneSaldoPendiente, type DatosEstadoFactura } from '../src/utils/estado-factura';
import * as espejoFront from '../../frontend/src/lib/estado-factura';

const f = (total: number, montoPagado: number, estado: DatosEstadoFactura['estado'] = 'emitida'): DatosEstadoFactura => ({ estado, total, montoPagado });

describe('derivarEstadoFactura', () => {
  it('emitida: la factura no tiene ningún pago', () => {
    expect(derivarEstadoFactura(f(100, 0))).toBe('emitida');
  });

  it('pendiente: pago parcial con saldo por pagar', () => {
    expect(derivarEstadoFactura(f(100, 40))).toBe('pendiente');
    expect(derivarEstadoFactura(f(100, 99.98))).toBe('pendiente');
  });

  it('pagada: sin saldo, también con tolerancia de un centavo', () => {
    expect(derivarEstadoFactura(f(100, 100))).toBe('pagada');
    expect(derivarEstadoFactura(f(100, 99.99))).toBe('pagada');
    expect(derivarEstadoFactura(f(0.3, 0.1 + 0.2))).toBe('pagada');
  });

  it('pagada: sobrepago', () => {
    expect(derivarEstadoFactura(f(100, 130))).toBe('pagada');
    expect(saldoFactura(f(100, 130))).toBe(0);
  });

  it('pagada: una nota de crédito (monto aplicado) que deja el saldo en 0', () => {
    // monto_pagado acumula efectivo + adelantos + notas de crédito
    expect(derivarEstadoFactura(f(100, 60 + 40))).toBe('pagada');
  });

  it('pendiente: un adelanto aplicado que no cubre toda la factura', () => {
    expect(derivarEstadoFactura(f(100, 30))).toBe('pendiente');
  });

  it('el estado guardado pagada se respeta si no hay montos (datos anteriores)', () => {
    expect(derivarEstadoFactura(f(100, 0, 'pagada'))).toBe('pagada');
  });

  it('el estado guardado pagada manda: una diferencia de monto no la devuelve a pendiente', () => {
    expect(derivarEstadoFactura(f(100, 40, 'pagada'))).toBe('pagada');
    expect(derivarEstadoFactura(f(100, 99.9, 'pagada'))).toBe('pagada');
    expect(espejoFront.derivarEstadoFactura(f(100, 40, 'pagada'))).toBe('pagada');
  });

  it('anulada y borrador no dependen de los pagos', () => {
    expect(derivarEstadoFactura(f(100, 100, 'anulada'))).toBe('anulada');
    expect(derivarEstadoFactura(f(100, 0, 'borrador'))).toBe('borrador');
    expect(derivarEstadoFactura(f(100, 50, 'borrador'))).toBe('borrador');
  });

  it('montos inválidos no rompen: se tratan como sin pagos', () => {
    expect(derivarEstadoFactura(f(100, Number.NaN))).toBe('emitida');
  });
});

describe('saldoFactura / tieneSaldoPendiente', () => {
  it('saldo exacto y nunca negativo', () => {
    expect(saldoFactura(f(100, 40))).toBe(60);
    expect(saldoFactura(f(100, 100))).toBe(0);
    expect(saldoFactura(f(100.5, 0.1))).toBe(100.4);
  });

  it('solo emitida y pendiente tienen deuda viva', () => {
    expect(['emitida', 'pendiente'].every(e => tieneSaldoPendiente(e as 'emitida'))).toBe(true);
    expect(['pagada', 'borrador', 'anulada'].some(e => tieneSaldoPendiente(e as 'pagada'))).toBe(false);
  });
});

describe('paridad backend / frontend', () => {
  const casos: DatosEstadoFactura[] = [
    f(100, 0), f(100, 40), f(100, 99.99), f(100, 100), f(100, 130), f(0, 0), f(0.3, 0.1 + 0.2),
    f(100, 0, 'pagada'), f(100, 40, 'pagada'), f(100, 100, 'anulada'), f(100, 10, 'borrador'),
  ];

  it('ambas copias devuelven el mismo estado y saldo', () => {
    for (const c of casos) {
      expect(espejoFront.derivarEstadoFactura(c)).toBe(derivarEstadoFactura(c));
      expect(espejoFront.saldoFactura(c)).toBe(saldoFactura(c));
    }
  });
});
