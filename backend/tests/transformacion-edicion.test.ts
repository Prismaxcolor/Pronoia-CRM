import { describe, it, expect } from 'vitest';
import { editarTransformacionSchema } from '../src/schemas/transformaciones-editar.js';
import {
  aplicarEdicion, cambiosEdicion, cambiosValoracion, normalizarNotas,
} from '../src/utils/edicion-transformacion.js';

describe('editarTransformacionSchema', () => {
  it('acepta fecha o notas', () => {
    expect(editarTransformacionSchema.safeParse({ fecha: '2026-09-30' }).success).toBe(true);
    expect(editarTransformacionSchema.safeParse({ notas: 'hola', llaveEdicion: 'ABC' }).success).toBe(true);
  });
  it('rechaza body sin fecha ni notas (la llave sola no cuenta)', () => {
    expect(editarTransformacionSchema.safeParse({}).success).toBe(false);
    expect(editarTransformacionSchema.safeParse({ llaveEdicion: 'ABC' }).success).toBe(false);
  });
  it('rechaza fecha mal formada y notas de más de 2000 caracteres', () => {
    expect(editarTransformacionSchema.safeParse({ fecha: '30/09/2026' }).success).toBe(false);
    expect(editarTransformacionSchema.safeParse({ notas: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('rechaza fechas con forma válida pero inexistentes en el calendario', () => {
    for (const fecha of ['2026-02-31', '2026-13-45', '2025-02-29', '2026-00-10']) {
      expect(editarTransformacionSchema.safeParse({ fecha }).success).toBe(false);
    }
    expect(editarTransformacionSchema.safeParse({ fecha: '2028-02-29' }).success).toBe(true);
  });
  it('ignora campos no editables (fotos, productos, lotes, almacén, neto): no se propagan', () => {
    const r = editarTransformacionSchema.parse({
      fecha: '2026-09-30', fotosEntrada: ['x'], productoEntradaId: 'p', almacenId: 'a', loteOrigenId: 'l', pesoNeto: 9,
    } as never);
    for (const campo of ['fotosEntrada', 'productoEntradaId', 'almacenId', 'loteOrigenId', 'pesoNeto']) {
      expect(r).not.toHaveProperty(campo);
    }
  });
});

describe('edición de transformación (lógica pura)', () => {
  const actual = { fecha: '2026-09-01', notas: 'vieja' };

  it('aplica solo los campos presentes sin mutar el original', () => {
    const r = aplicarEdicion(actual, { fecha: '2026-09-02' });
    expect(r).toEqual({ fecha: '2026-09-02', notas: 'vieja' });
    expect(actual).toEqual({ fecha: '2026-09-01', notas: 'vieja' });
  });
  it('notas vacías se guardan como null', () => {
    expect(aplicarEdicion(actual, { notas: '   ' }).notas).toBeNull();
    expect(normalizarNotas(undefined)).toBeNull();
  });
  it('detecta ausencia de cambios', () => {
    expect(cambiosEdicion(actual, aplicarEdicion(actual, { fecha: '2026-09-01', notas: 'vieja' }))).toEqual({});
  });
  it('devuelve antes/después de lo que cambió', () => {
    const c = cambiosEdicion(actual, aplicarEdicion(actual, { notas: 'nueva' }));
    expect(c).toEqual({ notas: { antes: 'vieja', despues: 'nueva' } });
  });
});

describe('cambiosValoracion', () => {
  const base = { facturaCompraId: null, costoUnitario: null, preciosSalida: { 'aaaaaaaa-1': null } };
  it('registra ancla, costo y precios cambiados', () => {
    const c = cambiosValoracion(base, { facturaCompraId: 'f1', costoUnitario: 2, preciosSalida: { 'aaaaaaaa-1': 3 } });
    expect(c.factura_compra_id).toEqual({ antes: null, despues: 'f1' });
    expect(c.costo_unitario).toEqual({ antes: null, despues: 2 });
    expect(c.precio_salida_aaaaaaaa).toEqual({ antes: null, despues: 3 });
  });
  it('sin diferencias no hay cambios', () => {
    expect(cambiosValoracion(base, { ...base })).toEqual({});
  });
});
