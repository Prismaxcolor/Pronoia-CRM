import { describe, it, expect } from 'vitest';
import { crearFacturaSchema } from '../src/schemas/facturas.js';
import { crearTransformacionSchema, completarTransformacionSchema } from '../src/schemas/transformaciones.js';
import { crearTicketSchema, completarTicketSchema } from '../src/schemas/tickets-pesaje.js';
import { crearListaSchema, actualizarListaSchema, upsertPrecioSchema } from '../src/schemas/listas-precios.js';
import { crearProveedorSchema } from '../src/schemas/proveedores.js';
import { crearTaraSchema, actualizarTaraSchema } from '../src/schemas/tara.js';
import { registrarPagoSchema, registrarPagoMultipleSchema } from '../src/schemas/pagos.js';
import { actualizarUsuarioSchema } from '../src/schemas/usuarios.js';
import { RECURSOS, ACCIONES } from '../src/utils/permisos.js';

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
  const base = { loteOrigenId: UUID, pesoBruto: 100, fecha: '2026-08-14' };

  it('acepta con tara por defecto 0', () => {
    const r = crearTransformacionSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.tara).toBe(0);
  });

  it('rechaza pesoBruto <= 0', () => {
    const r = crearTransformacionSchema.safeParse({ ...base, pesoBruto: 0 });
    expect(r.success).toBe(false);
  });

  it('rechaza fecha con formato inválido', () => {
    const r = crearTransformacionSchema.safeParse({ ...base, fecha: '14-08-2026' });
    expect(r.success).toBe(false);
  });

  it('rechaza loteOrigenId que no es uuid', () => {
    const r = crearTransformacionSchema.safeParse({ ...base, loteOrigenId: 'no-uuid' });
    expect(r.success).toBe(false);
  });
});

describe('completarTransformacionSchema', () => {
  it('acepta con al menos una salida, tara por defecto 0', () => {
    const r = completarTransformacionSchema.safeParse({
      salidas: [{ loteDestinoId: UUID, pesoBruto: 50 }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.salidas[0].tara).toBe(0);
  });

  it('acepta varias salidas', () => {
    const r = completarTransformacionSchema.safeParse({
      salidas: [
        { loteDestinoId: UUID, pesoBruto: 50 },
        { loteDestinoId: UUID2, pesoBruto: 30, tara: 2 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rechaza sin salidas', () => {
    const r = completarTransformacionSchema.safeParse({ salidas: [] });
    expect(r.success).toBe(false);
  });

  it('rechaza pesoBruto <= 0 en una salida', () => {
    const r = completarTransformacionSchema.safeParse({
      salidas: [{ loteDestinoId: UUID, pesoBruto: 0 }],
    });
    expect(r.success).toBe(false);
  });
});

describe('crearTicketSchema', () => {
  const material = { productoId: UUID2, pesoBruto: 100, tara: 10, fotos: ['https://x.com/foto.jpg'] };
  const base = { entidadId: UUID, pesoGlobal: 90, materiales: [material] };

  it('aplica tipo "compra" y devolucion 0 por defecto', () => {
    const r = crearTicketSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.tipo).toBe('compra');
      expect(r.data.materiales[0].devolucion).toBe(0);
    }
  });

  it('rechaza un material sin fotos (Bloque 46)', () => {
    const { fotos: _fotos, ...sinFotos } = material;
    const r = crearTicketSchema.safeParse({ ...base, materiales: [sinFotos] });
    expect(r.success).toBe(false);
  });

  it('acepta fotos por material', () => {
    const r = crearTicketSchema.safeParse({
      ...base,
      materiales: [{ ...material, fotos: ['https://x.com/a.jpg', 'https://x.com/b.jpg'] }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.materiales[0].fotos).toEqual(['https://x.com/a.jpg', 'https://x.com/b.jpg']);
  });

  it('rechaza sin peso global', () => {
    const { pesoGlobal: _pesoGlobal, ...sinPesoGlobal } = base;
    const r = crearTicketSchema.safeParse(sinPesoGlobal);
    expect(r.success).toBe(false);
  });

  it('rechaza peso global negativo', () => {
    const r = crearTicketSchema.safeParse({ ...base, pesoGlobal: -1 });
    expect(r.success).toBe(false);
  });

  it('acepta varios materiales', () => {
    const r = crearTicketSchema.safeParse({
      ...base,
      materiales: [material, { productoId: UUID, pesoBruto: 50, tara: 5, fotos: ['https://x.com/otra.jpg'] }],
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

  it('acepta un ticket en bruto (compra) sin materiales', () => {
    const r = crearTicketSchema.safeParse({ entidadId: UUID, pesoGlobal: 90, estado: 'bruto', materiales: [] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.estado).toBe('bruto');
  });

  it('rechaza un ticket en bruto de tipo venta', () => {
    const r = crearTicketSchema.safeParse({ entidadId: UUID, tipo: 'venta', estado: 'bruto', materiales: [] });
    expect(r.success).toBe(false);
  });

  it('rechaza estado "completo" (default) sin materiales', () => {
    const r = crearTicketSchema.safeParse({ entidadId: UUID, materiales: [] });
    expect(r.success).toBe(false);
  });
});

describe('completarTicketSchema', () => {
  const material = { productoId: UUID2, pesoBruto: 100, tara: 10, fotos: ['https://x.com/foto.jpg'] };

  it('exige al menos un material', () => {
    const r = completarTicketSchema.safeParse({ materiales: [] });
    expect(r.success).toBe(false);
  });

  it('acepta materiales válidos', () => {
    const r = completarTicketSchema.safeParse({ materiales: [material] });
    expect(r.success).toBe(true);
  });
});

describe('listas de precios', () => {
  it('crearListaSchema exige nombre y tipo', () => {
    expect(crearListaSchema.safeParse({ nombre: '', tipo: 'compra' }).success).toBe(false);
    expect(crearListaSchema.safeParse({ nombre: 'Precios Junio' }).success).toBe(false);
    expect(crearListaSchema.safeParse({ nombre: 'Precios Junio', tipo: 'compra' }).success).toBe(true);
    expect(crearListaSchema.safeParse({ nombre: 'Lista clientes', tipo: 'venta' }).success).toBe(true);
    expect(crearListaSchema.safeParse({ nombre: 'X', tipo: 'otro' }).success).toBe(false);
  });

  it('actualizarListaSchema ignora tipo (no editable después de crear)', () => {
    const r = actualizarListaSchema.safeParse({ activo: false, tipo: 'venta' });
    expect(r.success).toBe(true);
    if (r.success) expect((r.data as Record<string, unknown>).tipo).toBeUndefined();
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

  it('fotos es opcional pero cada una debe ser una URL válida si se envía', () => {
    expect(crearTaraSchema.safeParse({ nombre: 'X', peso: 10, fotos: ['no-es-url'] }).success).toBe(false);
    expect(crearTaraSchema.safeParse({ nombre: 'X', peso: 10, fotos: ['https://x.test/f.jpg'] }).success).toBe(true);
    expect(crearTaraSchema.safeParse({ nombre: 'X', peso: 10, fotos: ['https://x.test/f1.jpg', 'https://x.test/f2.jpg'] }).success).toBe(true);
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

  it('acepta un pago con comprobantes', () => {
    const r = registrarPagoSchema.safeParse({ ...base, comprobantes: ['https://x.supabase.co/storage/v1/object/public/comprobantes/abc.jpg'] });
    expect(r.success).toBe(true);
  });

  it('acepta un pago sin comprobantes (opcional, default vacío)', () => {
    const r = registrarPagoSchema.safeParse(base);
    expect(r.success && r.data.comprobantes).toEqual([]);
  });

  it('rechaza un comprobante que no es una URL válida', () => {
    expect(registrarPagoSchema.safeParse({ ...base, comprobantes: ['no-es-una-url'] }).success).toBe(false);
  });
});

const UUID3 = '33333333-3333-4333-8333-333333333333';

describe('registrarPagoMultipleSchema', () => {
  const base = {
    proveedorId: UUID,
    bancas: [{ bancaId: UUID2, monto: 1000, moneda: 'USD' as const, montoUsd: 1000 }],
    montoUsd: 1000,
    fecha: '2026-08-12',
    items: [] as never[],
  };

  it('acepta un pago con una sola banca que cubre el total exacto', () => {
    const r = registrarPagoMultipleSchema.safeParse(base);
    expect(r.success).toBe(true);
  });

  it('acepta un pago repartido entre 2 bancas cuya suma coincide con el total', () => {
    const r = registrarPagoMultipleSchema.safeParse({
      ...base,
      bancas: [
        { bancaId: UUID2, monto: 700, moneda: 'USD' as const, montoUsd: 700 },
        { bancaId: UUID3, monto: 300, moneda: 'USD' as const, montoUsd: 300 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rechaza si la suma de las bancas no coincide con el total a pagar', () => {
    const r = registrarPagoMultipleSchema.safeParse({ ...base, montoUsd: 1500 });
    expect(r.success).toBe(false);
  });

  it('rechaza bancas repetidas', () => {
    const r = registrarPagoMultipleSchema.safeParse({
      ...base,
      bancas: [
        { bancaId: UUID2, monto: 500, moneda: 'USD' as const, montoUsd: 500 },
        { bancaId: UUID2, monto: 500, moneda: 'USD' as const, montoUsd: 500 },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('rechaza sin ninguna banca', () => {
    const r = registrarPagoMultipleSchema.safeParse({ ...base, bancas: [] });
    expect(r.success).toBe(false);
  });

  it('rechaza si el total a pagar es menor a la suma de los ítems seleccionados', () => {
    const r = registrarPagoMultipleSchema.safeParse({
      ...base,
      montoUsd: 100,
      bancas: [{ bancaId: UUID2, monto: 100, moneda: 'USD' as const, montoUsd: 100 }],
      items: [{ tipo: 'factura' as const, id: UUID3, montoUsd: 500 }],
    });
    expect(r.success).toBe(false);
  });

  it('acepta el excedente del total sobre los ítems como adelanto implícito (sin error)', () => {
    const r = registrarPagoMultipleSchema.safeParse({
      ...base,
      montoUsd: 1000,
      bancas: [{ bancaId: UUID2, monto: 1000, moneda: 'USD' as const, montoUsd: 1000 }],
      items: [{ tipo: 'factura' as const, id: UUID3, montoUsd: 400 }],
    });
    expect(r.success).toBe(true);
  });
});

// Regresión: schemas/usuarios.ts tenía su propia lista de recursos hardcodeada
// y desincronizada (8 de 15) — guardar permisos personalizados de cualquiera de
// los 7 recursos faltantes (categorias, taras, almacenes, listas_precios,
// traslados, transformaciones, despachos) tiraba "Datos inválidos" con un error
// por cada uno. Ahora el schema deriva el enum de utils/permisos.ts, así que
// cualquier recurso/acción real de la matriz tiene que pasar.
describe('actualizarUsuarioSchema — permisos personalizados', () => {
  it('acepta un permiso para cada recurso y acción reales de la matriz', () => {
    for (const recurso of RECURSOS) {
      for (const accion of ACCIONES) {
        const r = actualizarUsuarioSchema.safeParse({ permisos: [{ recurso, accion }] });
        expect(r.success, `${recurso}:${accion} debería ser válido`).toBe(true);
      }
    }
  });

  it('rechaza un recurso que no existe en la matriz', () => {
    const r = actualizarUsuarioSchema.safeParse({ permisos: [{ recurso: 'no_existe', accion: 'ver' }] });
    expect(r.success).toBe(false);
  });
});
