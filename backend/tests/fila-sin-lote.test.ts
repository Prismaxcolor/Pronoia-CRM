import { describe, it, expect } from 'vitest';
import type { MaterialFila } from '../../frontend/src/features/pesaje/material-fila';
import { esFilaSinLote } from '../../frontend/src/features/pesaje/sin-lote-fila';

const productoSinLote = { id: 'p1', tipoMaterialSinLote: true, loteIds: [] };
const productoAnclado = { id: 'p1', tipoMaterialSinLote: true, loteIds: ['l1'] };
const fila = (extra: Partial<MaterialFila>): MaterialFila => ({ uid: 1, productoId: 'p1', subcategoria: '', pesoBruto: '', taraModo: 'manual', taraId: '', taraCantidad: '', taraManual: '', destino: '', fotos: [], ...extra });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const catalogo = (p: unknown) => [p] as any;

describe('esFilaSinLote', () => {
  it('fila nueva: categoría sin lote y producto sin anclajes es sin lote', () => {
    expect(esFilaSinLote(fila({}), catalogo(productoSinLote))).toBe(true);
  });
  it('fila nueva: producto anclado exige lote', () => {
    expect(esFilaSinLote(fila({}), catalogo(productoAnclado))).toBe(false);
  });
  it('ticket guardado en mpp sigue sin lote aunque el producto ya tenga lotes anclados', () => {
    const f = fila({ guardado: { productoId: 'p1', destinoTipo: 'mpp' } });
    expect(esFilaSinLote(f, catalogo(productoAnclado))).toBe(true);
  });
  it('ticket guardado en lote no cambia retroactivamente a mpp', () => {
    const f = fila({ guardado: { productoId: 'p1', destinoTipo: 'lote' }, destino: 'l9' });
    expect(esFilaSinLote(f, catalogo(productoSinLote))).toBe(false);
  });
  it('si se cambia el producto de la fila, vuelve a regir la regla de fila nueva', () => {
    const f = fila({ productoId: 'p1', guardado: { productoId: 'otro', destinoTipo: 'mpp' } });
    expect(esFilaSinLote(f, catalogo(productoAnclado))).toBe(false);
  });
});
