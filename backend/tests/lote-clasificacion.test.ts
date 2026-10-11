import { describe, it, expect } from 'vitest';
import { mensajeMigracionLote, MENSAJE_COLOR_NO_HABILITADO, MENSAJE_CLASIFICACION_NO_HABILITADA, MENSAJE_LOTE_MIGRACION_PENDIENTE } from '../src/services/lote-service.js';
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

describe('mensajeMigracionLote (409 por migración pendiente)', () => {
  const falta = (columna: string) => ({ code: '42703', message: `column lotes.${columna} does not exist` });
  const faltaPostgrest = (columna: string) => ({ code: 'PGRST204', message: `Could not find the '${columna}' column of 'lotes' in the schema cache` });

  it('si falta color_packing_list acusa al color aunque también se cambie la clase', () => {
    expect(mensajeMigracionLote(falta('color_packing_list'), { colorPackingList: 'green', clase: 'exportacion' })).toBe(MENSAJE_COLOR_NO_HABILITADO);
    expect(mensajeMigracionLote(faltaPostgrest('color_packing_list'), { colorPackingList: 'green' })).toBe(MENSAJE_COLOR_NO_HABILITADO);
  });
  it('si falta una columna de clasificación NO acusa al color aunque se cambie el color', () => {
    expect(mensajeMigracionLote(falta('clase'), { colorPackingList: 'green', clase: 'exportacion' })).toBe(MENSAJE_CLASIFICACION_NO_HABILITADA);
    expect(mensajeMigracionLote(faltaPostgrest('precio_estimado_kg'), { colorPackingList: 'green', precioEstimadoKg: 2 })).toBe(MENSAJE_CLASIFICACION_NO_HABILITADA);
  });
  it('sin pista en el error se decide por lo que se intentaba cambiar', () => {
    const sinPista = { code: '42703', message: 'column does not exist' };
    expect(mensajeMigracionLote(sinPista, { colorPackingList: 'green' })).toBe(MENSAJE_COLOR_NO_HABILITADO);
    expect(mensajeMigracionLote(sinPista, { clase: 'otro' })).toBe(MENSAJE_CLASIFICACION_NO_HABILITADA);
  });
  it('con ambos tipos de cambio y sin pista usa un mensaje genérico que no acusa a una sola migración', () => {
    const m = mensajeMigracionLote({ code: '42703', message: 'column does not exist' }, { colorPackingList: 'green', clase: 'otro' });
    expect(m).toBe(MENSAJE_LOTE_MIGRACION_PENDIENTE);
    expect(m).toMatch(/migration_inventario_rediseno_fase1/);
    expect(m).toMatch(/migration_packing_list_lote_fotos/);
  });
});
