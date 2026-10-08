import { describe, it, expect } from 'vitest';
import { CLASES_LOTE, construirUpdateClasificacion, leerClasificacion } from '../src/utils/lote-clasificacion.js';
import { actualizarLoteSchema } from '../src/schemas/lotes.js';
import { ENTIDADES_AUDITABLES, RECURSO_POR_ENTIDAD } from '../src/utils/auditoria.js';

const AHORA = new Date('2026-10-03T12:00:00.000Z');

describe('leerClasificacion', () => {
  it('sin columnas (migración pendiente) = otro, sin precio', () => {
    expect(leerClasificacion({})).toEqual({ clase: 'otro', precioEstimadoKg: null });
  });
  it('lee clase y precio (numeric llega como texto)', () => {
    expect(leerClasificacion({ clase: 'exportacion', precio_estimado_kg: '2.35' })).toEqual({ clase: 'exportacion', precioEstimadoKg: 2.35 });
  });
  it('valores raros caen a otro / null', () => {
    expect(leerClasificacion({ clase: 'basura', precio_estimado_kg: 'abc' })).toEqual({ clase: 'otro', precioEstimadoKg: null });
  });
});

describe('construirUpdateClasificacion', () => {
  const previo = { clase: 'otro' as const, precioEstimadoKg: null };

  it('cambia la clase sin tocar el sello del precio', () => {
    const r = construirUpdateClasificacion(previo, { clase: 'exportacion' }, 'u1', AHORA);
    expect(r.update).toEqual({ clase: 'exportacion' });
    expect(r.cambios).toEqual({ clase: { antes: 'otro', despues: 'exportacion' } });
  });
  it('cambiar el precio sella fecha y usuario', () => {
    const r = construirUpdateClasificacion(previo, { precioEstimadoKg: 1.5 }, 'u1', AHORA);
    expect(r.update).toEqual({
      precio_estimado_kg: 1.5,
      precio_estimado_actualizado_en: '2026-10-03T12:00:00.000Z',
      precio_estimado_actualizado_por: 'u1',
    });
    expect(r.cambios.precio_estimado_kg).toEqual({ antes: null, despues: 1.5 });
  });
  it('borrar el precio (null) tambien se sella', () => {
    const r = construirUpdateClasificacion({ clase: 'trabajo', precioEstimadoKg: 2 }, { precioEstimadoKg: null }, 'u2', AHORA);
    expect(r.update.precio_estimado_kg).toBeNull();
    expect(r.update.precio_estimado_actualizado_por).toBe('u2');
  });
  it('valores iguales a los actuales no producen cambios ni auditoria', () => {
    const r = construirUpdateClasificacion({ clase: 'trabajo', precioEstimadoKg: 2 }, { clase: 'trabajo', precioEstimadoKg: 2 }, 'u1', AHORA);
    expect(r.update).toEqual({});
    expect(r.cambios).toEqual({});
  });
  it('precio 0 es un precio valido (distinto de sin precio)', () => {
    const r = construirUpdateClasificacion(previo, { precioEstimadoKg: 0 }, 'u1', AHORA);
    expect(r.update.precio_estimado_kg).toBe(0);
  });
});

describe('actualizarLoteSchema con clase y precio estimado', () => {
  it('acepta clase y precio, y null para borrar el precio', () => {
    for (const clase of CLASES_LOTE) expect(actualizarLoteSchema.safeParse({ clase }).success).toBe(true);
    expect(actualizarLoteSchema.safeParse({ precioEstimadoKg: 1.25 }).success).toBe(true);
    expect(actualizarLoteSchema.safeParse({ precioEstimadoKg: null }).success).toBe(true);
    expect(actualizarLoteSchema.safeParse({ precioEstimadoKg: 0 }).success).toBe(true);
  });
  it('rechaza clase desconocida, precio negativo, enorme o no numerico', () => {
    expect(actualizarLoteSchema.safeParse({ clase: 'venta' }).success).toBe(false);
    expect(actualizarLoteSchema.safeParse({ precioEstimadoKg: -1 }).success).toBe(false);
    expect(actualizarLoteSchema.safeParse({ precioEstimadoKg: 1e7 }).success).toBe(false);
    expect(actualizarLoteSchema.safeParse({ precioEstimadoKg: '2' }).success).toBe(false);
  });
  it('sigue exigiendo al menos un campo y acepta los campos de antes', () => {
    expect(actualizarLoteSchema.safeParse({}).success).toBe(false);
    expect(actualizarLoteSchema.safeParse({ nombre: 'LOTE 9', activo: false }).success).toBe(true);
  });
});

describe('auditoria de lotes', () => {
  it('lote es una entidad auditable y su historial se lee con productos:ver', () => {
    expect(ENTIDADES_AUDITABLES).toContain('lote');
    expect(RECURSO_POR_ENTIDAD.lote).toBe('productos');
  });
});
