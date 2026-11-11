import { describe, it, expect, vi } from 'vitest';
import { calcularCruce } from '../../frontend/src/lib/cruce';
import { validarPagoCobro, type EntradaPagoCobro } from '../../frontend/src/features/estado-cuenta/pago-cobro-validacion';
import { huellaPagoCobro, type DatosEnvioPagoCobro } from '../../frontend/src/features/estado-cuenta/pago-cobro-envio';
import {
  conComprobantesDeBanca, fotosPorBanca, subirComprobantesPorBanca,
} from '../../frontend/src/features/estado-cuenta/pago-cobro-comprobantes';
import { comprobantesPorBanca as hayComprobantesPorBanca } from '../../frontend/src/features/estado-cuenta/detalle-comprobantes';
import type { FotoLocal } from '../../frontend/src/lib/foto-picker';
import type { FacturaCV } from '../../frontend/src/services/factura-cv-service';
import type { Banca } from '../../shared/types/banca';

const existente = (url: string): FotoLocal => ({ tipo: 'existente', url });
const nueva = (nombre: string): FotoLocal => ({ tipo: 'nueva', file: new File(['x'], nombre, { type: 'image/jpeg', lastModified: 1 }), preview: `blob:${nombre}` });

describe('cruce con una factura de total 0', () => {
  it('con permiteCero es un cruce puro sin error y sin efectivo', () => {
    const r = calcularCruce([{ tipo: 'factura', montoUsd: 0, permiteCero: true }]);
    expect(r).toMatchObject({ error: null, efectivo: 0, esCrucePuro: true, totalFacturas: 0 });
  });

  it('sin permiteCero un monto 0 sigue siendo inválido', () => {
    expect(calcularCruce([{ tipo: 'factura', montoUsd: 0 }]).error).toMatch(/mayor a 0/);
  });

  it('permiteCero solo vale para facturas: una nota con 0 es inválida', () => {
    expect(calcularCruce([{ tipo: 'nota_debito', montoUsd: 0, permiteCero: true }]).error).toMatch(/mayor a 0/);
  });

  it('una factura en 0 junto a otra con saldo no suma nada pero deja pagar la otra', () => {
    const r = calcularCruce([{ tipo: 'factura', montoUsd: 0, permiteCero: true }, { tipo: 'factura', montoUsd: 50 }]);
    expect(r).toMatchObject({ error: null, efectivo: 50, esCrucePuro: false });
  });
});

describe('validarPagoCobro con una factura de total 0', () => {
  const enCero = { id: 'f0', codigo: 'FC-0', total: 0, montoPagado: 0 } as FacturaCV;
  const conSaldo = { id: 'f1', codigo: 'FC-1', total: 100, montoPagado: 0 } as FacturaCV;
  const usd = { id: 'b-usd', nombre: 'Caja USD', moneda: 'USD' } as Banca;

  const base = (extra: Partial<EntradaPagoCobro> = {}): EntradaPagoCobro => ({
    esProveedor: true, etiquetaAdelanto: 'adelanto',
    cruce: calcularCruce([{ tipo: 'factura', montoUsd: 0, permiteCero: true }]), hayItems: true, esCrucePuro: true,
    totalItems: 0, totalEditadoNum: 0,
    facturasSel: [enCero], montosFactura: { f0: '0.00' }, notasSel: [], notasCreditoSel: [], adelantosSel: [], montosAdelanto: {},
    lineas: [], bancas: [usd], tasaDeLinea: () => null,
    comision: { estado: 'no-disponible', disponible: false },
    categorias: { opciones: [], cargando: false, fallo: false }, categoriaCobroId: null,
    ...extra,
  });

  it('se cierra como cruce puro: ítem de monto 0, sin bancas ni dinero', () => {
    const r = validarPagoCobro(base());
    expect(r).toMatchObject({ bancas: [], hayDinero: false, items: [{ tipo: 'factura', id: 'f0', montoUsd: 0 }] });
  });

  it('un monto vacío en la factura en 0 se toma como 0', () => {
    expect(validarPagoCobro(base({ montosFactura: { f0: '' } }))).toMatchObject({ items: [{ id: 'f0', montoUsd: 0 }] });
  });

  it('una factura con saldo NO se puede pagar con monto 0', () => {
    const r = validarPagoCobro(base({ facturasSel: [conSaldo], montosFactura: { f1: '0' } }));
    expect(r).toEqual({ error: expect.stringMatching(/mayor a 0/i) });
  });

  it('una factura en 0 no admite un monto mayor (supera su saldo)', () => {
    const r = validarPagoCobro(base({ montosFactura: { f0: '5' }, cruce: calcularCruce([{ tipo: 'factura', montoUsd: 5 }]), totalItems: 5, totalEditadoNum: 5, esCrucePuro: false }));
    expect(r).toEqual({ error: expect.stringMatching(/supera su saldo/i) });
  });

  it('un monto negativo se rechaza', () => {
    expect(validarPagoCobro(base({ montosFactura: { f0: '-1' } }))).toEqual({ error: expect.stringMatching(/mayor a 0/i) });
  });
});

describe('comprobantes por banca en el formulario', () => {
  it('fotosPorBanca toma solo las líneas con cuenta elegida y al menos una foto', () => {
    const r = fotosPorBanca([
      { bancaId: 'a', comprobantes: [existente('u1')] }, { bancaId: 'b', comprobantes: [] }, { bancaId: 'c' }, { bancaId: '', comprobantes: [existente('u2')] },
    ]);
    expect(Object.keys(r)).toEqual(['a']);
  });

  it('subirComprobantesPorBanca sube las nuevas, conserva las existentes y devuelve bancaId -> URLs', async () => {
    const subir = vi.fn(async (f: File) => `https://sb/${f.name}`);
    const r = await subirComprobantesPorBanca({ a: [existente('https://sb/ya.jpg'), nueva('n1.jpg')], b: [nueva('n2.jpg')] }, subir);
    expect(r).toEqual({ a: ['https://sb/ya.jpg', 'https://sb/n1.jpg'], b: ['https://sb/n2.jpg'] });
    expect(subir).toHaveBeenCalledTimes(2);
  });

  it('si falla la subida de cualquier banca devuelve null (no se registra con comprobantes a medias)', async () => {
    const subir = vi.fn(async (f: File) => (f.name === 'malo.jpg' ? null : `https://sb/${f.name}`));
    expect(await subirComprobantesPorBanca({ a: [nueva('ok.jpg')], b: [nueva('malo.jpg')] }, subir)).toBeNull();
  });

  it('sin fotos por banca no sube nada y devuelve un mapa vacío', async () => {
    const subir = vi.fn();
    expect(await subirComprobantesPorBanca({}, subir)).toEqual({});
    expect(subir).not.toHaveBeenCalled();
  });

  it('conComprobantesDeBanca pone las URLs en su banca y no añade la clave a las demás', () => {
    const r = conComprobantesDeBanca([{ bancaId: 'a', monto: 1 }, { bancaId: 'b', monto: 2 }], { a: ['u1'] });
    expect(r).toEqual([{ bancaId: 'a', monto: 1, comprobantes: ['u1'] }, { bancaId: 'b', monto: 2 }]);
    expect(r[1]).not.toHaveProperty('comprobantes');
  });

  it('la huella cambia si se cambia la foto de una banca (reintento distinto) y no si es la misma', () => {
    const datos = (fotos: Record<string, FotoLocal[]>): DatosEnvioPagoCobro => ({
      esProveedor: true, entidadId: 'p1', bancas: [{ bancaId: 'a', monto: 100, moneda: 'USD', montoUsd: 100 }],
      items: [{ tipo: 'factura', id: 'f1', montoUsd: 100 }], esCrucePuro: false, hayDinero: false, totalEditadoNum: 100,
      descripcion: '', fecha: '2026-11-10', comprobantes: [], comprobantesBanca: fotos, categoriaOpciones: [], categoriaCobroId: null,
    });
    expect(huellaPagoCobro(datos({ a: [existente('u1')] }))).toBe(huellaPagoCobro(datos({ a: [existente('u1')] })));
    expect(huellaPagoCobro(datos({ a: [existente('u1')] }))).not.toBe(huellaPagoCobro(datos({ a: [existente('u2')] })));
    expect(huellaPagoCobro(datos({}))).not.toBe(huellaPagoCobro(datos({ a: [existente('u1')] })));
  });
});

describe('detalle del pago: comprobantes por banca', () => {
  it('solo se muestran por banca cuando dos o más cuentas traen los suyos', () => {
    expect(hayComprobantesPorBanca([{ comprobantes: ['a'] }, { comprobantes: ['b'] }])).toBe(true);
    expect(hayComprobantesPorBanca([{ comprobantes: ['a'] }, { comprobantes: [] }])).toBe(false);
    expect(hayComprobantesPorBanca([{}, {}])).toBe(false);
  });
});
