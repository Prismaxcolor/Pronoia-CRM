import { describe, it, expect } from 'vitest';
import { crearFacturaSchema } from '../src/schemas/facturas.js';
import { crearTransformacionSchema } from '../src/schemas/transformaciones.js';
import { crearTicketSchema } from '../src/schemas/tickets-pesaje.js';
import { crearListaSchema, upsertPrecioSchema } from '../src/schemas/listas-precios.js';
import { crearProveedorSchema } from '../src/schemas/proveedores.js';

const UUID = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';

describe('crearFacturaSchema', () => {
  const base = { entidadId: UUID, productoId: UUID2, precioUnitario: 5 };

  it('acepta factura con ticket', () => {
    const r = crearFacturaSchema.safeParse({ ...base, ticketId: UUID });
    expect(r.success).toBe(true);
  });

  it('acepta factura con peso manual', () => {
    const r = crearFacturaSchema.safeParse({ ...base, pesoManual: 10 });
    expect(r.success).toBe(true);
  });

  it('rechaza factura sin ticket ni peso manual', () => {
    const r = crearFacturaSchema.safeParse(base);
    expect(r.success).toBe(false);
  });

  it('rechaza precio unitario <= 0', () => {
    const r = crearFacturaSchema.safeParse({ ...base, ticketId: UUID, precioUnitario: 0 });
    expect(r.success).toBe(false);
  });

  it('rechaza entidadId que no es uuid', () => {
    const r = crearFacturaSchema.safeParse({ ...base, entidadId: 'no-uuid', ticketId: UUID });
    expect(r.success).toBe(false);
  });

  it('aplica estado por defecto "emitida"', () => {
    const r = crearFacturaSchema.safeParse({ ...base, ticketId: UUID });
    expect(r.success && r.data.estado).toBe('emitida');
  });
});

describe('crearTransformacionSchema', () => {
  const base = { materialEntradaId: UUID, cantidadEntrada: 100 };

  it('acepta cuando la suma de salidas <= entrada', () => {
    const r = crearTransformacionSchema.safeParse({
      ...base,
      detalles: [
        { materialSalidaId: UUID2, cantidad: 80 },
        { materialSalidaId: UUID, cantidad: 19 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rechaza cuando la suma de salidas supera la entrada', () => {
    const r = crearTransformacionSchema.safeParse({
      ...base,
      detalles: [{ materialSalidaId: UUID2, cantidad: 101 }],
    });
    expect(r.success).toBe(false);
  });

  it('rechaza sin materiales de salida', () => {
    const r = crearTransformacionSchema.safeParse({ ...base, detalles: [] });
    expect(r.success).toBe(false);
  });
});

describe('crearTicketSchema', () => {
  const base = { entidadId: UUID, productoId: UUID2, pesoBruto: 100, tara: 10 };

  it('aplica tipo "compra" y devolucion 0 por defecto', () => {
    const r = crearTicketSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.tipo).toBe('compra');
      expect(r.data.devolucion).toBe(0);
    }
  });

  it('rechaza peso bruto negativo', () => {
    const r = crearTicketSchema.safeParse({ ...base, pesoBruto: -1 });
    expect(r.success).toBe(false);
  });
});

describe('listas de precios', () => {
  it('crearListaSchema exige nombre', () => {
    expect(crearListaSchema.safeParse({ nombre: '' }).success).toBe(false);
    expect(crearListaSchema.safeParse({ nombre: 'Precios Junio' }).success).toBe(true);
  });

  it('upsertPrecioSchema exige precio > 0', () => {
    expect(upsertPrecioSchema.safeParse({ productoId: UUID, precio: 0 }).success).toBe(false);
    expect(upsertPrecioSchema.safeParse({ productoId: UUID, precio: 15 }).success).toBe(true);
  });
});

describe('crearProveedorSchema', () => {
  it('exige nombre', () => {
    expect(crearProveedorSchema.safeParse({ nombre: '' }).success).toBe(false);
  });

  it('rechaza email inválido', () => {
    expect(crearProveedorSchema.safeParse({ nombre: 'X', email: 'no-es-email' }).success).toBe(false);
  });

  it('normaliza opcionales vacíos a null', () => {
    const r = crearProveedorSchema.safeParse({ nombre: 'Reciclados', rfc: '', telefono: '' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.rfc).toBeNull();
      expect(r.data.telefono).toBeNull();
    }
  });
});
