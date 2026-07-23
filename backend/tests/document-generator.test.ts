import { describe, it, expect } from 'vitest';
import {
  generarFacturaPdf,
  generarTicketPdf,
  nombreArchivoFactura,
  nombreArchivoTicket,
} from '../src/services/document-generator.js';
import type { FacturaPublica } from '../src/services/factura-service.js';
import type { TicketPublico } from '../src/services/ticket-pesaje-service.js';

const FACTURA: FacturaPublica = {
  id: '11111111-1111-4111-8111-111111111111',
  numero: 7,
  codigo: 'Compra 0007',
  tipo: 'compra',
  entidadId: '22222222-2222-4222-8222-222222222222',
  nombreEntidad: 'Reciclados El Valle C.A.',
  ticketIds: [],
  items: [
    { id: 'a', productoId: 'p1', nombreProducto: 'Cobre', peso: 10, precioUnitario: 5, subtotal: 50 },
  ],
  total: 50,
  montoPagado: 0,
  descripcion: null,
  observaciones: null,
  estado: 'emitida',
  createdAt: '2026-07-01T12:00:00.000Z',
};

const TICKET: TicketPublico = {
  id: '33333333-3333-4333-8333-333333333333',
  numero: 3,
  codigo: 'Pesaje 0003',
  tipo: 'compra',
  entidadId: '22222222-2222-4222-8222-222222222222',
  fecha: '2026-07-01',
  materiales: [
    {
      id: 'm1',
      productoId: 'p1',
      nombreProducto: 'Cobre',
      subcategoria: null,
      pesoBruto: 12,
      tara: 2,
      devolucion: 0,
      pesoNeto: 10,
      destinoTipo: 'mpp',
      loteId: null,
      nombreLote: null,
    },
  ],
  pesoNetoTotal: 10,
  pesoGlobal: 10,
  diferencia: 0,
  fotos: [],
  observaciones: null,
  facturado: false,
  estado: 'completo',
  pesadoPor: null,
  completadoPor: null,
  completadoEn: null,
  createdAt: '2026-07-01T12:00:00.000Z',
};

describe('nombreArchivoFactura', () => {
  it('usa el código de la factura en minúsculas', () => {
    expect(nombreArchivoFactura(FACTURA)).toBe('factura-compra-compra-0007.pdf');
  });
});

describe('nombreArchivoTicket', () => {
  it('usa el código del ticket en minúsculas', () => {
    expect(nombreArchivoTicket(TICKET)).toBe('ticket-pesaje-0003.pdf');
  });
});

describe('generarFacturaPdf', () => {
  it('produce un buffer PDF válido y no vacío', () => {
    const buffer = generarFacturaPdf(FACTURA);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(500);
  });

  it('no rompe con una factura sin líneas', () => {
    const buffer = generarFacturaPdf({ ...FACTURA, items: [], total: 0 });
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('no rompe con acentos y ñ en nombre/observaciones', () => {
    const buffer = generarFacturaPdf({
      ...FACTURA,
      nombreEntidad: 'Compañía Metálica José Peña',
      observaciones: 'Facturación según acuerdo — año 2026, sección Añasco',
    });
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('generarTicketPdf', () => {
  it('produce un buffer PDF válido y no vacío', () => {
    const buffer = generarTicketPdf(TICKET, 'Reciclados El Valle C.A.');
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(500);
  });

  it('no rompe con un ticket sin materiales', () => {
    const buffer = generarTicketPdf({ ...TICKET, materiales: [], pesoNetoTotal: 0 }, 'Sin Materiales C.A.');
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('no rompe con acentos y ñ en el nombre de la entidad', () => {
    const buffer = generarTicketPdf(TICKET, 'Compañía Metálica José Peña');
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
