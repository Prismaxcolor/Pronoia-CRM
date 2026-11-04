import { describe, it, expect } from 'vitest';
import { calcularDesgloseAlmacen, type MovimientoAlmacen } from '../src/services/inventario-almacen-desglose.js';

const mov = (m: Partial<MovimientoAlmacen> & Pick<MovimientoAlmacen, 'tipo' | 'peso'>): MovimientoAlmacen => ({
  productoId: null,
  loteId: null,
  ...m,
});

describe('calcularDesgloseAlmacen', () => {
  it('relaciona compras, ventas, traslados y transformaciones de un producto sin lote', () => {
    const lineas = calcularDesgloseAlmacen([
      mov({ tipo: 'compra', productoId: 'p1', peso: 1000 }),
      mov({ tipo: 'venta', productoId: 'p1', peso: 300 }),
      mov({ tipo: 'traslado_entrada', productoId: 'p1', peso: 50 }),
      mov({ tipo: 'traslado_salida', productoId: 'p1', peso: 20 }),
      mov({ tipo: 'transf_entrada', productoId: 'p1', peso: 100 }),
      mov({ tipo: 'transf_salida', productoId: 'p1', peso: 80 }),
      mov({ tipo: 'ajuste', productoId: 'p1', peso: -5 }),
    ]);
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toMatchObject({
      productoId: 'p1', loteId: null,
      compras: 1000, ventas: 300, trasladoEntrada: 50, trasladoSalida: 20,
      transfEntrada: 100, transfSalida: 80, ajustes: -5,
    });
    // 1000 - 300 + 50 - 20 - 100 + 80 - 5
    expect(lineas[0].stock).toBe(705);
  });

  it('agrupa los movimientos de un lote en una sola línea de lote, aunque unos traigan producto y otros no', () => {
    const lineas = calcularDesgloseAlmacen([
      mov({ tipo: 'ajuste', loteId: 'bgpp', peso: 12293.9 }),
      mov({ tipo: 'traslado_salida', loteId: 'bgpp', peso: 9 }),
      mov({ tipo: 'compra', loteId: 'bgpp', productoId: 'p9', peso: 100 }),
    ]);
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toMatchObject({ productoId: null, loteId: 'bgpp', ajustes: 12293.9, trasladoSalida: 9, compras: 100 });
    expect(lineas[0].stock).toBeCloseTo(12384.9, 6);
  });

  it('mantiene separados el mismo producto sin lote y dentro de un lote', () => {
    const lineas = calcularDesgloseAlmacen([
      mov({ tipo: 'compra', productoId: 'p1', peso: 10 }),
      mov({ tipo: 'compra', productoId: 'p1', loteId: 'l1', peso: 40 }),
    ]);
    expect(lineas).toHaveLength(2);
    expect(lineas.find(l => l.loteId === null)?.stock).toBe(10);
    expect(lineas.find(l => l.loteId === 'l1')?.stock).toBe(40);
  });

  it('conserva stock negativo y líneas con movimiento aunque el neto sea cero', () => {
    const lineas = calcularDesgloseAlmacen([
      mov({ tipo: 'venta', productoId: 'neg', peso: 7 }),
      mov({ tipo: 'compra', productoId: 'cero', peso: 5 }),
      mov({ tipo: 'venta', productoId: 'cero', peso: 5 }),
    ]);
    expect(lineas.find(l => l.productoId === 'neg')?.stock).toBe(-7);
    expect(lineas.find(l => l.productoId === 'cero')).toMatchObject({ compras: 5, ventas: 5, stock: 0 });
  });

  it('ignora movimientos sin producto ni lote y pesos no numéricos', () => {
    const lineas = calcularDesgloseAlmacen([
      mov({ tipo: 'compra', peso: 10 }),
      mov({ tipo: 'compra', productoId: 'p1', peso: Number.NaN }),
    ]);
    expect(lineas).toEqual([]);
  });

  it('la suma de stock de todas las líneas es la suma firmada de los movimientos', () => {
    const lineas = calcularDesgloseAlmacen([
      mov({ tipo: 'compra', productoId: 'a', peso: 100 }),
      mov({ tipo: 'transf_entrada', productoId: 'a', peso: 40 }),
      mov({ tipo: 'transf_salida', productoId: 'b', peso: 38 }),
      mov({ tipo: 'transf_salida', loteId: 'l', peso: 2 }),
      mov({ tipo: 'venta', productoId: 'b', peso: 10 }),
    ]);
    expect(lineas.reduce((acc, l) => acc + l.stock, 0)).toBe(100 - 40 + 38 + 2 - 10);
  });
});
