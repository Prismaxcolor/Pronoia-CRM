import { describe, it, expect } from 'vitest';
import { contarMaterialesDistintos, resumenMateriales } from '../../frontend/src/features/pesaje/resumen-materiales';

const m = (productoId: string | null, nombreProducto: string | null = null) => ({ productoId, nombreProducto, loteId: null as string | null, nombreLote: null as string | null });

describe('contarMaterialesDistintos', () => {
  it('cuenta productos únicos, no pesadas', () => {
    expect(contarMaterialesDistintos([m('a'), m('a'), m('b'), m('a')])).toBe(2);
  });
  it('productos distintos con el mismo lote de destino cuentan por producto', () => {
    const enLote = (id: string) => ({ ...m(id), loteId: 'PCB' as string | null });
    expect(contarMaterialesDistintos([enLote('a'), enLote('b'), enLote('c'), enLote('d'), enLote('e')])).toBe(5);
  });
  it('lista vacía = 0', () => {
    expect(contarMaterialesDistintos([])).toBe(0);
  });
  it('un lote completo cuenta por su lote, distinto de un producto', () => {
    expect(contarMaterialesDistintos([m('a'), { ...m(null), loteId: 'L1' }, { ...m(null), loteId: 'L1' }])).toBe(2);
  });
  it('filas sin producto ni lote se cuentan por separado', () => {
    expect(contarMaterialesDistintos([m(null), m(null)])).toBe(2);
  });
});

describe('resumenMateriales', () => {
  it('varias pesadas del mismo material muestran el nombre, no "N materiales"', () => {
    expect(resumenMateriales([m('a', 'Cobre'), m('a', 'Cobre'), m('a', 'Cobre')])).toBe('Cobre');
  });
  it('dos materiales distintos con varias pesadas', () => {
    expect(resumenMateriales([m('a', 'Cobre'), m('b', 'Hierro'), m('a', 'Cobre')])).toBe('2 materiales');
  });
  it('sin materiales muestra guion', () => {
    expect(resumenMateriales([])).toBe('—');
  });
  it('lote completo único muestra el nombre del lote', () => {
    expect(resumenMateriales([{ ...m(null), loteId: 'L1', nombreLote: 'Lote A' }])).toBe('Lote A (lote completo)');
  });
});
