import { describe, it, expect } from 'vitest';
import { buscarEvento, destinoEvento } from '../src/services/grupo-eventos.js';
import { cuentasDeBody } from '../src/services/grupo-dinero.js';

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
