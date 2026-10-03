import { describe, it, expect } from 'vitest';
import {
  parsearEfectosFactura,
  construirAvisosFactura,
  cambiosAuditoriaFactura,
  type EfectoFactura,
} from '../src/utils/factura-ticket-edicion.js';

const anulada: EfectoFactura = {
  tipo: 'compra', facturaId: 'f1', numero: 11, entidadId: 'p1', total: 265.4, montoPagado: 0,
  estadoAnterior: 'emitida', accion: 'anulada', ticketsLiberados: 1,
};
const pagada: EfectoFactura = {
  tipo: 'venta', facturaId: 'f2', numero: 3, entidadId: 'c1', total: 100, montoPagado: 100,
  estadoAnterior: 'pagada', accion: 'pagada', ticketsLiberados: 0,
};
const nombres = new Map([['p1', 'Proveedor Uno'], ['c1', 'Cliente Uno']]);

describe('parsearEfectosFactura', () => {
  it('devuelve [] cuando la respuesta no es un arreglo', () => {
    expect(parsearEfectosFactura(null)).toEqual([]);
    expect(parsearEfectosFactura({})).toEqual([]);
  });

  it('descarta elementos inválidos y convierte números', () => {
    const r = parsearEfectosFactura([
      { ...anulada, total: '265.40', numero: '11' },
      { tipo: 'otra', accion: 'anulada' },
      { ...pagada, accion: 'rara' },
      null,
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ facturaId: 'f1', numero: 11, total: 265.4, accion: 'anulada' });
  });
});

describe('construirAvisosFactura', () => {
  it('sin facturas no hay avisos', () => {
    expect(construirAvisosFactura([], nombres)).toEqual([]);
  });

  it('factura anulada: aviso tipo anulada con código, mensaje y ruta de estado de cuenta del proveedor', () => {
    const [a] = construirAvisosFactura([anulada], nombres);
    expect(a.tipo).toBe('anulada');
    expect(a.facturaCodigo).toBe('C-0011');
    expect(a.entidadTipo).toBe('proveedor');
    expect(a.entidadNombre).toBe('Proveedor Uno');
    expect(a.rutaEstadoCuenta).toBe('/proveedores/p1/estado-cuenta');
    expect(a.mensaje).toContain('Se anuló la factura N° C-0011');
    expect(a.mensaje).toContain('volver a facturar');
  });

  it('factura pagada: aviso tipo pagada, no anulada, insta a revisar el estado de cuenta del cliente', () => {
    const [a] = construirAvisosFactura([pagada], nombres);
    expect(a.tipo).toBe('pagada');
    expect(a.facturaCodigo).toBe('V-0003');
    expect(a.entidadTipo).toBe('cliente');
    expect(a.rutaEstadoCuenta).toBe('/clientes/c1/estado-cuenta');
    expect(a.mensaje).toContain('V-0003');
    expect(a.mensaje).toMatch(/ya fue pagada/);
    expect(a.mensaje).toMatch(/no se anuló/i);
    expect(a.mensaje).toMatch(/estado de cuenta/i);
  });

  it('factura emitida con pagos parciales se avisa como con pagos aplicados', () => {
    const parcial: EfectoFactura = { ...pagada, estadoAnterior: 'emitida', montoPagado: 40 };
    const [a] = construirAvisosFactura([parcial], nombres);
    expect(a.tipo).toBe('pagada');
    expect(a.mensaje).toMatch(/pagos aplicados/);
  });

  it('sin nombre de entidad resuelto usa "la entidad"; sin entidadId no hay ruta', () => {
    const [a] = construirAvisosFactura([{ ...pagada, entidadId: null }], new Map());
    expect(a.entidadNombre).toBeNull();
    expect(a.rutaEstadoCuenta).toBeNull();
  });

  it('ordena primero las pagadas (más críticas)', () => {
    const r = construirAvisosFactura([anulada, pagada], nombres);
    expect(r.map(x => x.tipo)).toEqual(['pagada', 'anulada']);
  });
});

describe('cambiosAuditoriaFactura', () => {
  it('anotar anulada indica estado anterior y que el ticket queda disponible', () => {
    const cambios = cambiosAuditoriaFactura(construirAvisosFactura([anulada], nombres));
    expect(cambios['Factura C-0011']).toEqual({ antes: 'emitida', despues: 'anulada (ticket disponible para volver a facturar)' });
  });

  it('anotar pagada indica que no se anuló', () => {
    const cambios = cambiosAuditoriaFactura(construirAvisosFactura([pagada], nombres));
    expect(cambios['Factura V-0003']).toEqual({ antes: 'pagada', despues: 'pagada, NO anulada (revisar estado de cuenta)' });
  });

  it('sin avisos no agrega cambios', () => {
    expect(cambiosAuditoriaFactura([])).toEqual({});
  });
});
