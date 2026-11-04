import { describe, it, expect } from 'vitest';
import { calcularCruce } from '../../frontend/src/lib/cruce';
import {
  disponibleDeNota, errorMontoDeNota, montoAplicadoDeNota, montoSugeridoDeNota,
} from '../../frontend/src/lib/cruce-notas';
import { validarPagoCobro, type EntradaPagoCobro } from '../../frontend/src/features/estado-cuenta/pago-cobro-validacion';
import { notaAplicadaEnParte, textoNotaAplicadaEnParte } from '../../frontend/src/features/estado-cuenta/estado-cuenta-comun';
import type { EntradaEstadoCuenta } from '../../frontend/src/services/estado-cuenta-service';
import type { FacturaCV } from '../../frontend/src/services/factura-cv-service';
import type { Banca } from '../../shared/types/banca';

const nd = (extra: Partial<EntradaEstadoCuenta> = {}): EntradaEstadoCuenta => ({
  fecha: '2026-10-02', tipo: 'nota_debito', descripcion: 'Flete', referencia: 'ND-0001', cargo: 100, abono: 0, notaId: 'n1', ...extra,
});
const nc = (extra: Partial<EntradaEstadoCuenta> = {}): EntradaEstadoCuenta => ({
  fecha: '2026-10-02', tipo: 'nota_credito', descripcion: 'Descuento', referencia: 'NC-0001', cargo: 0, abono: 100, notaId: 'n2', ...extra,
});

describe('disponibleDeNota', () => {
  it('sin dato del servidor es el monto completo', () => {
    expect(disponibleDeNota(nd())).toBe(100);
    expect(disponibleDeNota(nc())).toBe(100);
  });
  it('con aplicación parcial es lo que informó el servidor', () => {
    expect(disponibleDeNota(nd({ notaDisponible: 60 }))).toBe(60);
    expect(disponibleDeNota(nc({ notaDisponible: 12.345 }))).toBe(12.35);
  });
});

describe('montoAplicadoDeNota', () => {
  it('sin edición aplica todo lo disponible', () => {
    expect(montoAplicadoDeNota(nd({ notaDisponible: 60 }), {}, 'n1')).toBe(60);
  });
  it('con edición aplica lo escrito', () => {
    expect(montoAplicadoDeNota(nd(), { n1: '25.50' }, 'n1')).toBe(25.5);
  });
  it('un texto vacío o inválido cuenta como 0 (la validación lo rechaza)', () => {
    expect(montoAplicadoDeNota(nd(), { n1: '' }, 'n1')).toBe(0);
    expect(montoAplicadoDeNota(nd(), { n1: 'abc' }, 'n1')).toBe(0);
  });
});

describe('montoSugeridoDeNota', () => {
  it('la nota de débito se sugiere completa (lo que le queda)', () => {
    expect(montoSugeridoDeNota(nd({ notaDisponible: 60 }), 'debito', 0)).toBe(60);
  });
  it('la nota de crédito se sugiere por lo que falta cubrir, sin pasar de lo disponible', () => {
    expect(montoSugeridoDeNota(nc(), 'credito', 30)).toBe(30);
    expect(montoSugeridoDeNota(nc({ notaDisponible: 20 }), 'credito', 30)).toBe(20);
  });
  it('si no hay nada pendiente por cubrir sugiere lo disponible (el usuario decide)', () => {
    expect(montoSugeridoDeNota(nc(), 'credito', 0)).toBe(100);
  });
});

describe('errorMontoDeNota', () => {
  it('rechaza 0, negativos y más de lo disponible', () => {
    expect(errorMontoDeNota(nd(), 0, 'ND-0001')).toMatch(/mayor a 0/);
    expect(errorMontoDeNota(nd({ notaDisponible: 60 }), 60.01, 'ND-0001')).toBeNull(); // tolerancia de un centavo
    expect(errorMontoDeNota(nd({ notaDisponible: 60 }), 61, 'ND-0001')).toMatch(/supera lo disponible/);
  });
  it('acepta cualquier parte de la nota', () => {
    expect(errorMontoDeNota(nd(), 0.01, 'ND-0001')).toBeNull();
    expect(errorMontoDeNota(nd(), 100, 'ND-0001')).toBeNull();
  });
});

describe('cruce con notas parciales', () => {
  it('una nota de crédito aplicada por una parte baja el efectivo solo por esa parte', () => {
    const r = calcularCruce([
      { tipo: 'factura', montoUsd: 100 },
      { tipo: 'nota_credito', montoUsd: montoAplicadoDeNota(nc(), { n2: '30' }, 'n2') },
    ]);
    expect(r.efectivo).toBe(70);
    expect(r.error).toBeNull();
  });

  it('una nota de débito aplicada en parte suma solo esa parte', () => {
    const r = calcularCruce([
      { tipo: 'factura', montoUsd: 50 },
      { tipo: 'nota_debito', montoUsd: montoAplicadoDeNota(nd(), { n1: '20' }, 'n1') },
    ]);
    expect(r.efectivo).toBe(70);
  });
});

describe('validarPagoCobro con notas parciales', () => {
  const factura = { id: 'f1', codigo: 'FC-1', total: 100, montoPagado: 0 } as FacturaCV;
  const usd = { id: 'b-usd', nombre: 'Caja USD', moneda: 'USD' } as Banca;

  const entrada = (extra: Partial<EntradaPagoCobro> = {}): EntradaPagoCobro => {
    const notasCreditoSel = [nc({ notaDisponible: 40 })];
    const montosNota = { n2: '30' };
    return {
      esProveedor: true, etiquetaAdelanto: 'adelanto',
      cruce: calcularCruce([{ tipo: 'factura', montoUsd: 100 }, { tipo: 'nota_credito', montoUsd: 30 }]), hayItems: true, esCrucePuro: false,
      totalItems: 70, totalEditadoNum: 70,
      facturasSel: [factura], montosFactura: { f1: '100.00' }, notasSel: [], notasCreditoSel, montosNota, adelantosSel: [], montosAdelanto: {},
      lineas: [{ id: 0, bancaId: 'b-usd', montoUsd: '70', referencia: '' }], bancas: [usd], tasaDeLinea: () => null,
      comision: { estado: 'no-disponible', disponible: false },
      categorias: { opciones: [], cargando: false, fallo: false }, categoriaCobroId: null,
      ...extra,
    };
  };

  it('envía el monto parcial de la nota, no el de la nota completa', () => {
    const r = validarPagoCobro(entrada());
    expect(r).toMatchObject({ items: [{ tipo: 'factura', id: 'f1', montoUsd: 100 }, { tipo: 'nota_credito', id: 'n2', montoUsd: 30 }] });
  });

  it('rechaza aplicar más de lo que le queda a la nota', () => {
    const r = validarPagoCobro(entrada({ montosNota: { n2: '55' } }));
    expect(r).toEqual({ error: expect.stringMatching(/ND?C-0001|supera lo disponible/i) });
  });

  it('rechaza un monto de nota en 0', () => {
    const r = validarPagoCobro(entrada({ montosNota: { n2: '0' } }));
    expect(r).toEqual({ error: expect.stringMatching(/mayor a 0/i) });
  });

  it('una nota de débito sin monto escrito se envía por todo lo que le queda', () => {
    const notasSel = [nd({ notaDisponible: 60 })];
    const r = validarPagoCobro(entrada({
      notasSel, notasCreditoSel: [], montosNota: {},
      cruce: calcularCruce([{ tipo: 'factura', montoUsd: 100 }, { tipo: 'nota_debito', montoUsd: 60 }]), totalItems: 160, totalEditadoNum: 160,
      lineas: [{ id: 0, bancaId: 'b-usd', montoUsd: '160', referencia: '' }],
    }));
    expect(r).toMatchObject({ items: [{ tipo: 'factura' }, { tipo: 'nota_debito', id: 'n1', montoUsd: 60 }] });
  });

  it('funciona sin montosNota (llamadores anteriores)', () => {
    const r = validarPagoCobro(entrada({ montosNota: undefined }));
    expect(r).toMatchObject({ items: [{ tipo: 'factura' }, { tipo: 'nota_credito', montoUsd: 40 }] });
  });
});

describe('texto de una nota aplicada en parte', () => {
  it('se detecta solo en notas vigentes con algo aplicado y no agotadas', () => {
    expect(notaAplicadaEnParte(nd({ notaAplicada: 40, notaDisponible: 60 }))).toBe(true);
    expect(notaAplicadaEnParte(nd({ notaAplicada: 0 }))).toBe(false);
    expect(notaAplicadaEnParte(nd({ notaAplicada: 100, pagada: true }))).toBe(false);
    expect(notaAplicadaEnParte(nd({ notaAplicada: 40, anulada: true }))).toBe(false);
    expect(notaAplicadaEnParte({ tipo: 'factura', notaAplicada: 40 })).toBe(false);
  });
  it('muestra lo aplicado y lo que queda', () => {
    expect(textoNotaAplicadaEnParte({ notaAplicada: 40, notaDisponible: 60 })).toMatch(/Aplicada \$40,00 · por aplicar \$60,00/);
  });
});
