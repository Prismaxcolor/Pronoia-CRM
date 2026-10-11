import { describe, it, expect } from 'vitest';
import {
  actualizarCategoriaSchema, asignarCategoriaSchema, crearCategoriaSchema, filtroReporteCategoriasSchema, filtroReporteCuentaSchema,
} from '../src/schemas/categorias-wallet.js';
import { crearMovimientoSchema } from '../src/schemas/cochinito.js';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

describe('crearCategoriaSchema', () => {
  it('normaliza nombre y color; el color por omisión es un gris', () => {
    const r = crearCategoriaSchema.parse({ nombre: '  Servicios ', tipo: 'EGRESO', color: '#dc2626' });
    expect(r).toMatchObject({ nombre: 'Servicios', color: '#DC2626', padreId: null });
    expect(crearCategoriaSchema.parse({ nombre: 'X', tipo: 'AMBOS' }).color).toMatch(/^#[0-9A-F]{6}$/);
  });
  it('rechaza nombre vacío, tipo desconocido y colores inválidos', () => {
    expect(crearCategoriaSchema.safeParse({ nombre: ' ', tipo: 'EGRESO' }).success).toBe(false);
    expect(crearCategoriaSchema.safeParse({ nombre: 'A', tipo: 'OTRO' }).success).toBe(false);
    expect(crearCategoriaSchema.safeParse({ nombre: 'A', tipo: 'EGRESO', color: 'rojo' }).success).toBe(false);
    expect(crearCategoriaSchema.safeParse({ nombre: 'A'.repeat(81), tipo: 'EGRESO' }).success).toBe(false);
  });
  it('el padre debe ser uuid', () => {
    expect(crearCategoriaSchema.safeParse({ nombre: 'A', tipo: 'EGRESO', padreId: 'x' }).success).toBe(false);
    expect(crearCategoriaSchema.parse({ nombre: 'A', tipo: 'EGRESO', padreId: U1 }).padreId).toBe(U1);
  });
});

describe('actualizarCategoriaSchema', () => {
  it('exige al menos un campo y no permite cambiar de padre', () => {
    expect(actualizarCategoriaSchema.safeParse({}).success).toBe(false);
    expect(actualizarCategoriaSchema.parse({ activo: false })).toEqual({ activo: false });
    expect(actualizarCategoriaSchema.parse({ nombre: 'N', padreId: U1 } as never)).toEqual({ nombre: 'N' });
  });
});

describe('asignarCategoriaSchema', () => {
  it('categoriaId uuid o null explícito; no se puede omitir', () => {
    expect(asignarCategoriaSchema.parse({ categoriaId: U1 }).categoriaId).toBe(U1);
    expect(asignarCategoriaSchema.parse({ categoriaId: null }).categoriaId).toBeNull();
    expect(asignarCategoriaSchema.safeParse({}).success).toBe(false);
    expect(asignarCategoriaSchema.safeParse({ categoriaId: 'abc' }).success).toBe(false);
  });
});

describe('filtros de reportes', () => {
  it('cuenta: bancaId uuid y rango ordenado', () => {
    expect(filtroReporteCuentaSchema.safeParse({ bancaId: U1, desde: '2026-10-01', hasta: '2026-10-31' }).success).toBe(true);
    expect(filtroReporteCuentaSchema.safeParse({ bancaId: 'x', desde: '2026-10-01', hasta: '2026-10-31' }).success).toBe(false);
    expect(filtroReporteCuentaSchema.safeParse({ bancaId: U1, desde: '2026-10-31', hasta: '2026-10-01' }).success).toBe(false);
  });
  it('rechaza rangos de más de un año (límite de consulta)', () => {
    expect(filtroReporteCuentaSchema.safeParse({ bancaId: U1, desde: '2026-01-01', hasta: '2026-12-31' }).success).toBe(true);
    expect(filtroReporteCuentaSchema.safeParse({ bancaId: U1, desde: '2025-01-01', hasta: '2026-12-31' }).success).toBe(false);
  });
  it('categorías: lista separada por comas, opcional, y sinCategoria booleano', () => {
    const r = filtroReporteCategoriasSchema.parse({ categorias: `${U1},${U2}`, desde: '2026-10-01', hasta: '2026-10-31', sinCategoria: 'true' });
    expect(r.categorias).toEqual([U1, U2]);
    expect(r.sinCategoria).toBe(true);
    const vacio = filtroReporteCategoriasSchema.parse({ desde: '2026-10-01', hasta: '2026-10-31' });
    expect(vacio.categorias).toEqual([]);
    expect(vacio.sinCategoria).toBe(false);
    expect(filtroReporteCategoriasSchema.safeParse({ categorias: 'x,y', desde: '2026-10-01', hasta: '2026-10-31' }).success).toBe(false);
  });
});

describe('crearMovimientoSchema con categoría', () => {
  const base = { tipo: 'egreso', bancaId: U1, monto: 5, moneda: 'USD', fecha: '2026-10-05' };
  it('acepta categoriaId uuid, null u omitido', () => {
    expect(crearMovimientoSchema.parse({ ...base, categoriaId: U2 }).categoriaId).toBe(U2);
    expect(crearMovimientoSchema.parse({ ...base, categoriaId: null }).categoriaId).toBeNull();
    expect(crearMovimientoSchema.parse(base).categoriaId).toBeUndefined();
  });
  it('rechaza categoriaId que no es uuid y en transferencias', () => {
    expect(crearMovimientoSchema.safeParse({ ...base, categoriaId: 'x' }).success).toBe(false);
    expect(crearMovimientoSchema.safeParse({ ...base, tipo: 'transferencia', bancaDestinoId: U2, categoriaId: U2 }).success).toBe(false);
  });
});
