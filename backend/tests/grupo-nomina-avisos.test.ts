import { describe, it, expect } from 'vitest';
import {
  buscarEvento, cantidadCuotas, comprobantesPagoNomina, comprobantesPrestamo, destinoEvento, detallesPrestamo, type ContextoEvento,
} from '../src/services/grupo-eventos.js';
import { comprobantesReenviables, cuentasDeBody } from '../src/services/grupo-dinero.js';

const SUPA = 'https://proyecto.supabase.co';
const URL_OK = `${SUPA}/storage/v1/object/public/comprobantes/a.jpg`;
const ctx = (resBody: Record<string, unknown>, params: Record<string, string> = {}): ContextoEvento =>
  ({ metodo: 'POST', ruta: '/x', params, reqBody: {}, resBody, extra: {} });

describe('detalle del aviso de préstamos y adelantos', () => {
  const prestamo = {
    numero: 7, trabajadorNombre: 'Ana Pérez', tipo: 'PRESTAMO', montoUsd: 100, cuotaSemanalUsd: 30, fecha: '2026-11-04', nota: null,
    desembolso: { bancaNombre: 'CAJA CHICA', monto: 100, moneda: 'USD', referencia: '8841', movimientoNumero: 12, fecha: '2026-11-04', comprobantes: [URL_OK] },
  };
  it('lista personal, monto, cuota y cantidad de cuotas', () => {
    const t = detallesPrestamo(ctx({ prestamo })).join('\n');
    expect(t).toContain('Personal: Ana Pérez');
    expect(t).toContain('Tipo: Préstamo');
    expect(t).toContain('Cantidad de cuotas: 4');
    expect(t).toContain('Referencia: 8841');
    expect(t).toContain('MV-0012');
  });
  it('avisa cuando no hay cuota semanal', () => {
    expect(detallesPrestamo(ctx({ prestamo: { ...prestamo, cuotaSemanalUsd: null, desembolso: null } })).join('\n'))
      .toContain('sin cuota semanal definida');
  });
  it('avisa cuando el préstamo se registró pero su pago aún no', () => {
    expect(detallesPrestamo(ctx({ prestamo: { ...prestamo, desembolso: null } })).join('\n'))
      .toContain('Pago: aún no registrado desde el Wallet');
  });
  it('redondea la cantidad de cuotas hacia arriba', () => {
    expect(cantidadCuotas(100, 30)).toBe(4);
    expect(cantidadCuotas(90, 30)).toBe(3);
    expect(cantidadCuotas(100, null)).toBeNull();
  });
  it('toma el comprobante del pago que devuelve el servidor', () => {
    expect(comprobantesPrestamo(ctx({ prestamo }))).toEqual([URL_OK]);
  });
});

describe('comprobantes del aviso de nómina', () => {
  const nomina = { pagos: [
    { trabajadorId: null, anulado: false, comprobantes: [URL_OK] },
    { trabajadorId: 't1', anulado: false, comprobantes: [`${SUPA}/storage/v1/object/public/comprobantes/b.jpg`] },
    { trabajadorId: null, anulado: true, comprobantes: [`${SUPA}/storage/v1/object/public/comprobantes/c.jpg`] },
  ] };
  it('pago de toda la nómina: solo los pagos vigentes sin trabajador', () => {
    expect(comprobantesPagoNomina(ctx({ nomina }))).toEqual([URL_OK]);
  });
  it('pago individual: solo los del trabajador', () => {
    expect(comprobantesPagoNomina(ctx({ nomina }, { trabajadorId: 't1' }))).toHaveLength(1);
  });
  it('reenvía los comprobantes de pagos[] y desembolso del body, sin repetir ni aceptar URLs ajenas', () => {
    const r = comprobantesReenviables(
      { pagos: [{ comprobantes: [URL_OK] }], desembolso: { comprobantes: [URL_OK, 'https://malo.example/x.jpg'] } }, SUPA, [URL_OK],
    );
    expect(r).toEqual([URL_OK]);
  });
});

const FILTRO = { silenciados: [], incluirRuidosos: false };

describe('avisos de dinero de nómina al grupo de cajas', () => {
  it.each([
    ['POST', '/api/nomina/nominas/n1/pagar', 'nomina.pagada'],
    ['POST', '/api/nomina/nominas/n1/trabajadores/t1/pagar', 'nomina.trabajador_pagado'],
    ['POST', '/api/nomina/prestamos/p1/pagar', 'nomina.prestamo_pagado'],
    ['POST', '/api/nomina/prestamos', 'nomina.prestamo_creado'],
    ['POST', '/api/nomina/nominas/n1/anular', 'nomina.anulada'],
  ])('%s %s se avisa a cajas', (metodo, ruta, clave) => {
    const encontrado = buscarEvento(metodo as 'POST', ruta);
    expect(encontrado?.evento.clave).toBe(clave);
    expect(destinoEvento(encontrado!.evento, FILTRO)).toBe('cajas');
  });
  it('reconoce las cuentas del body de pago de nómina (pagos[] y desembolso)', () => {
    const pagos = cuentasDeBody({ pagos: [{ moneda: 'BS', bancaId: 'b1' }, { moneda: 'USD', bancaId: 'b2' }] });
    expect(pagos.map(c => c.id)).toEqual(['b1', 'b2']);
    expect(cuentasDeBody({ desembolso: { bancaId: 'b3', monto: 10 } }).map(c => c.id)).toEqual(['b3']);
  });
});
