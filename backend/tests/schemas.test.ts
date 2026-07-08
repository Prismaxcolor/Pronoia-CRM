import { describe, it, expect } from 'vitest';
import { crearFacturaSchema } from '../src/schemas/facturas.js';
import { crearTransformacionSchema } from '../src/schemas/transformaciones.js';
import { crearTicketSchema } from '../src/schemas/tickets-pesaje.js';
import { crearListaSchema, upsertPrecioSchema } from '../src/schemas/listas-precios.js';
import { crearProveedorSchema } from '../src/schemas/proveedores.js';
import { crearTaraSchema, actualizarTaraSchema } from '../src/schemas/tara.js';
import { registrarPagoSchema } from '../src/schemas/pagos.js';

const UUID = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';

describe('crearFacturaSchema', () => {
  const item = { productoId: UUID2, peso: 10, precioUnitario: 5 };
  const base = { entidadId: UUID, items: [item] };

  it('acepta factura con varios tickets', () => {
    const r = crearFacturaSchema.safeParse({ ...base, ticketIds: [UUID, UUID2] });
    expect(r.success).toBe(true);
  });

  it('ticketIds por defecto es []', () => {
    const r = crearFacturaSchema.safeParse(base);
    expect(r.success && r.data.ticketIds).toEqual([]);
  });

  it('acepta factura con varias líneas', () => {
    const r = crearFacturaSchema.safeParse({
      ...base,
      items: [item, { productoId: UUID, peso: 3, precioUnitario: 8 }],
    });
    expect(r.success).toBe(true);
  });

  it('rechaza factura sin líneas', () => {
    const r = crearFacturaSchema.safeParse({ ...base, items: [] });
    expect(r.success).toBe(false);
  });

  it('rechaza precio unitario <= 0', () => {
    const r = crearFacturaSchema.safeParse({ ...base, items: [{ ...item, precioUnitario: 0 }] });
    expect(r.success).toBe(false);
  });

  it('rechaza peso <= 0', () => {
    const r = crearFacturaSchema.safeParse({ ...base, items: [{ ...item, peso: 0 }] });
    expect(r.success).toBe(false);
  });

  it('rechaza entidadId que no es uuid', () => {
    const r = crearFacturaSchema.safeParse({ ...base, entidadId: 'no-uuid' });
    expect(r.success).toBe(false);
  });

  it('aplica estado por defecto "emitida"', () => {
    const r = crearFacturaSchema.safeParse(base);
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
  const material = { productoId: UUID2, pesoBruto: 100, tara: 10 };
  const base = { entidadId: UUID, materiales: [material] };

  it('aplica tipo "compra" y devolucion 0 por defecto', () => {
    const r = crearTicketSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.tipo).toBe('compra');
      expect(r.data.materiales[0].devolucion).toBe(0);
    }
  });

  it('acepta varios materiales', () => {
    const r = crearTicketSchema.safeParse({
      ...base,
      materiales: [material, { productoId: UUID, pesoBruto: 50, tara: 5 }],
    });
    expect(r.success).toBe(true);
  });

  it('rechaza sin materiales', () => {
    const r = crearTicketSchema.safeParse({ ...base, materiales: [] });
    expect(r.success).toBe(false);
  });

  it('rechaza peso bruto negativo', () => {
    const r = crearTicketSchema.safeParse({ ...base, materiales: [{ ...material, pesoBruto: -1 }] });
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

describe('crearTaraSchema', () => {
  it('exige nombre y peso positivo', () => {
    expect(crearTaraSchema.safeParse({ nombre: '', peso: 10 }).success).toBe(false);
    expect(crearTaraSchema.safeParse({ nombre: 'Camión 3 ejes', peso: 0 }).success).toBe(false);
    expect(crearTaraSchema.safeParse({ nombre: 'Camión 3 ejes', peso: 8500 }).success).toBe(true);
  });

  it('foto es opcional pero debe ser una URL válida si se envía', () => {
    expect(crearTaraSchema.safeParse({ nombre: 'X', peso: 10, foto: 'no-es-url' }).success).toBe(false);
    expect(crearTaraSchema.safeParse({ nombre: 'X', peso: 10, foto: 'https://x.test/f.jpg' }).success).toBe(true);
  });
});

describe('actualizarTaraSchema', () => {
  it('rechaza objeto vacío', () => {
    expect(actualizarTaraSchema.safeParse({}).success).toBe(false);
  });

  it('acepta actualizar solo el campo activo', () => {
    expect(actualizarTaraSchema.safeParse({ activo: false }).success).toBe(true);
  });
});

describe('registrarPagoSchema', () => {
  const base = {
    proveedorId: UUID,
    bancaId: UUID2,
    monto: 100,
    moneda: 'USD' as const,
    montoUsd: 100,
    fecha: '2026-07-08',
  };

  it('acepta un pago válido sin factura (adelanto)', () => {
    const r = registrarPagoSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.facturaId ?? null).toBeNull();
  });

  it('acepta un pago ligado a una factura', () => {
    const r = registrarPagoSchema.safeParse({ ...base, facturaId: UUID });
    expect(r.success).toBe(true);
  });

  it('rechaza monto o montoUsd <= 0', () => {
    expect(registrarPagoSchema.safeParse({ ...base, monto: 0 }).success).toBe(false);
    expect(registrarPagoSchema.safeParse({ ...base, montoUsd: 0 }).success).toBe(false);
  });

  it('rechaza moneda distinta de USD/VES', () => {
    expect(registrarPagoSchema.safeParse({ ...base, moneda: 'EUR' }).success).toBe(false);
  });

  it('rechaza fecha con formato inválido', () => {
    expect(registrarPagoSchema.safeParse({ ...base, fecha: '08/07/2026' }).success).toBe(false);
  });
});
