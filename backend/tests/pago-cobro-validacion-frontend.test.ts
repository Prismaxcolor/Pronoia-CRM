import { describe, it, expect } from 'vitest';
import { calcularCruce } from '../../frontend/src/lib/cruce';
import { validarPagoCobro, type EntradaPagoCobro } from '../../frontend/src/features/estado-cuenta/pago-cobro-validacion';
import { huellaPagoCobro, type DatosEnvioPagoCobro } from '../../frontend/src/features/estado-cuenta/pago-cobro-envio';
import type { FacturaCV } from '../../frontend/src/services/factura-cv-service';
import type { Banca } from '../../shared/types/banca';

const factura = { id: 'f1', codigo: 'FC-1', total: 100, montoPagado: 0 } as FacturaCV;
const usd = { id: 'b-usd', nombre: 'Caja USD', moneda: 'USD' } as Banca;

const base = (extra: Partial<EntradaPagoCobro> = {}): EntradaPagoCobro => ({
  esProveedor: true, etiquetaAdelanto: 'adelanto',
  cruce: calcularCruce([{ tipo: 'factura', montoUsd: 100 }]), hayItems: true, esCrucePuro: false,
  totalItems: 100, totalEditadoNum: 100,
  facturasSel: [factura], montosFactura: { f1: '100.00' }, notasSel: [], notasCreditoSel: [], adelantosSel: [], montosAdelanto: {},
  lineas: [{ id: 0, bancaId: 'b-usd', montoUsd: '100', referencia: ' ref ' }], bancas: [usd], tasaDeLinea: () => null,
  comision: { estado: 'no-disponible', disponible: false },
  categorias: { opciones: [], cargando: false, fallo: false }, categoriaCobroId: null,
  ...extra,
});

describe('validarPagoCobro', () => {
  it('un pago correcto arma bancas e ítems', () => {
    const r = validarPagoCobro(base());
    expect(r).toMatchObject({ hayDinero: false, items: [{ tipo: 'factura', id: 'f1', montoUsd: 100 }] });
    expect('bancas' in r && r.bancas[0]).toMatchObject({ bancaId: 'b-usd', monto: 100, moneda: 'USD', referencia: 'ref' });
  });

  it('sin nada seleccionado ni monto, pide elegir algo', () => {
    const r = validarPagoCobro(base({ hayItems: false, totalEditadoNum: 0, totalItems: 0, facturasSel: [], montosFactura: {} }));
    expect(r).toEqual({ error: expect.stringMatching(/al menos una factura/i) });
  });

  it('el monto de una factura no puede superar su saldo', () => {
    const r = validarPagoCobro(base({ montosFactura: { f1: '150' } }));
    expect(r).toEqual({ error: expect.stringMatching(/supera su saldo/i) });
  });

  it('la suma de las bancas debe cuadrar con el total', () => {
    const r = validarPagoCobro(base({ lineas: [{ id: 0, bancaId: 'b-usd', montoUsd: '40', referencia: '' }] }));
    expect(r).toEqual({ error: expect.stringMatching(/no coincide/i) });
  });

  it('un cruce puro no pide banca', () => {
    const r = validarPagoCobro(base({ esCrucePuro: true, lineas: [], totalEditadoNum: 0, totalItems: 0, cruce: calcularCruce([{ tipo: 'factura', montoUsd: 100 }, { tipo: 'adelanto', montoUsd: 100 }]) }));
    expect('bancas' in r && r.bancas).toEqual([]);
  });

  it('un cobro con las categorías sin cargar no se puede registrar', () => {
    const r = validarPagoCobro(base({ esProveedor: false, categorias: { opciones: [], cargando: true, fallo: false } }));
    expect(r).toEqual({ error: expect.stringMatching(/categor/i) });
  });
});

describe('huellaPagoCobro (idempotencia)', () => {
  const datos = (extra: Partial<DatosEnvioPagoCobro> = {}): DatosEnvioPagoCobro => ({
    esProveedor: true, entidadId: 'p1', bancas: [{ bancaId: 'b', monto: 100, moneda: 'USD', montoUsd: 100 }],
    items: [{ tipo: 'factura', id: 'f1', montoUsd: 100 }], esCrucePuro: false, hayDinero: false, totalEditadoNum: 100,
    descripcion: '', fecha: '2026-10-16', comprobantes: [], categoriaOpciones: [], categoriaCobroId: null, ...extra,
  });

  it('es la misma para el mismo formulario (reintento) y cambia si el usuario cambia algo', () => {
    expect(huellaPagoCobro(datos())).toBe(huellaPagoCobro(datos()));
    expect(huellaPagoCobro(datos({ totalEditadoNum: 90 }))).not.toBe(huellaPagoCobro(datos()));
    expect(huellaPagoCobro(datos({ fecha: '2026-10-17' }))).not.toBe(huellaPagoCobro(datos()));
  });
});
