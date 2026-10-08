import { describe, it, expect } from 'vitest';
import {
  generarEstadoCuentaPdf,
  generarNotaPdf,
  generarPagoPdf,
  nombreArchivoEstadoCuenta,
  nombreArchivoNota,
  nombreArchivoPago,
  type NotaParaPdf,
} from '../src/services/document-generator-financiero.js';
import type { PagoDetalle } from '../src/services/pago-detalle-service.js';
import { resumenComprobante } from '../src/utils/comprobante-resumen.js';

const esPdf = (b: Buffer) => b.subarray(0, 5).toString() === '%PDF-' && b.length > 1000;

const nota = (extra: Partial<NotaParaPdf> = {}): NotaParaPdf => ({
  id: 'abcdef12-0000-4000-8000-000000000000', codigo: 'NC-0004', tipo: 'credito', monto: 50, motivo: 'Ajuste por diferencia',
  anulada: false, fecha: '2026-10-03', anuladaAt: null, anuladaMotivo: null, facturaAsociada: null, ...extra,
});

const pago = (extra: Partial<PagoDetalle> = {}): PagoDetalle => {
  const base: PagoDetalle = {
  grupoId: '55555555-5555-4555-8555-555555555555', entidadTipo: 'proveedor', entidadId: 'P1', nombreEntidad: 'Reciclados El Valle',
  fecha: '2026-10-03', descripcion: null, comprobantes: [], registradoPor: 'Operador Interno',
  bancas: [{ bancaId: 'B1', bancaNombre: 'Banesco USD', monto: 100, moneda: 'USD', montoUsd: 100, referencia: 'REF-1' }],
  totalUsd: 100, codigoPago: 'PG-0007', codigoAdelanto: null, codigoCruce: null,
  items: [{ tipo: 'factura', codigo: 'C-0003', montoUsd: 100 }], resumen: [], ...extra,
  };
  return { ...base, resumen: extra.resumen ?? resumenComprobante(base.items, base.totalUsd, base.entidadTipo === 'proveedor') };
};

describe('nota de crédito/débito', () => {
  it('genera PDF válido para crédito, débito, anulada, de proveedor y de cliente', () => {
    expect(esPdf(generarNotaPdf(nota(), 'Proveedor SA', true))).toBe(true);
    expect(esPdf(generarNotaPdf(nota({ tipo: 'debito', codigo: 'NDV-0002' }), 'Cliente SA', false))).toBe(true);
    expect(esPdf(generarNotaPdf(nota({ anulada: true, anuladaAt: '2026-10-04T10:00:00Z', anuladaMotivo: 'Error' }), 'Proveedor SA', true))).toBe(true);
    expect(esPdf(generarNotaPdf(nota({ facturaAsociada: { id: 'f', codigo: 'C-0001' }, codigo: null }), 'Proveedor SA', true))).toBe(true);
  });

  it('soporta caracteres tipográficos de Word/Docs en el motivo sin romper', () => {
    expect(esPdf(generarNotaPdf(nota({ motivo: 'Ajuste − “precio” — revisión…' }), 'X', true))).toBe(true);
  });

  it('nombre de archivo estable', () => {
    expect(nombreArchivoNota(nota())).toBe('Nota-credito-NC-0004.pdf');
    expect(nombreArchivoNota(nota({ codigo: null }))).toBe('Nota-credito-abcdef12.pdf');
  });
});

describe('comprobante de pago / cobro / cruce', () => {
  it('pago con desglose y banca', () => {
    expect(esPdf(generarPagoPdf(pago()))).toBe(true);
    expect(nombreArchivoPago(pago())).toBe('Pago-PG-0007-Reciclados-El-Valle.pdf');
  });

  it('pago con adelanto, nota de crédito y varias bancas', () => {
    const p = pago({
      codigoAdelanto: 'AD-0002',
      items: [{ tipo: 'factura', codigo: 'C-0003', montoUsd: 100 }, { tipo: 'nota_credito', codigo: 'NC-0001', montoUsd: 10 }, { tipo: 'adelanto', codigo: 'AD-0001', montoUsd: 20 }, { tipo: 'nota_debito', codigo: null, montoUsd: 5 }],
      bancas: [
        { bancaId: 'B1', bancaNombre: 'Banesco', monto: 60, moneda: 'USD', montoUsd: 60, referencia: null },
        { bancaId: 'B2', bancaNombre: null, monto: 2400, moneda: 'VES', montoUsd: 60, referencia: 'TRF-2' },
      ],
    });
    expect(esPdf(generarPagoPdf(p))).toBe(true);
  });

  it('pago sin desglose (legacy) muestra la descripción', () => {
    expect(esPdf(generarPagoPdf(pago({ items: [], descripcion: 'Pago de chatarra' })))).toBe(true);
  });

  it('cobro de cliente', () => {
    const c = pago({ entidadTipo: 'cliente', codigoPago: 'CB-0003' });
    expect(esPdf(generarPagoPdf(c))).toBe(true);
    expect(nombreArchivoPago(c)).toBe('Cobro-CB-0003-Reciclados-El-Valle.pdf');
  });

  it('cruce sin dinero', () => {
    const c = pago({ codigoPago: null, codigoCruce: 'CR-0001', bancas: [], totalUsd: 0 });
    expect(esPdf(generarPagoPdf(c))).toBe(true);
    expect(nombreArchivoPago(c)).toBe('Cruce-CR-0001-Reciclados-El-Valle.pdf');
  });
});

describe('estado de cuenta', () => {
  it('genera PDF con entradas y totales (también vacío)', () => {
    const base = { entidad: { id: 'P1', tipo: 'proveedor' as const, nombre: 'Reciclados El Valle' }, totales: { facturado: 500, pagado: 200, saldo: 300 } };
    const entradas = Array.from({ length: 80 }, (_, i) => ({ fecha: '2026-10-01', tipo: 'factura' as const, descripcion: 'x', referencia: `C-${i}`, cargo: 10, abono: 0 }));
    expect(esPdf(generarEstadoCuentaPdf({ ...base, entradas }, '2026-10-03'))).toBe(true); // varias páginas
    expect(esPdf(generarEstadoCuentaPdf({ ...base, entradas: [] }, '2026-10-03'))).toBe(true);
    expect(nombreArchivoEstadoCuenta({ ...base, entradas: [] }, '2026-10-03')).toBe('estado-de-cuenta-reciclados-el-valle-2026-10-03.pdf');
  });
});
