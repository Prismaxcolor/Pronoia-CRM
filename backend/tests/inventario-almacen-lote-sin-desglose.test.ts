import { describe, it, expect } from 'vitest';
import { calcularLotesSinDesglose } from '../src/services/inventario-service.js';

describe('calcularLotesSinDesglose', () => {
  it('incluye el traslado de un lote sin desglose: total del almacén menos lo atribuido a productos', () => {
    // BGPP en G1: ajuste de toma física 12293.9 y traslado enviado -9 → total 12284.9.
    const resultado = calcularLotesSinDesglose([
      { loteId: 'l1', nombreLote: 'BGPP', stockTotalAlmacen: 12284.9, stockPorProducto: [] },
    ]);
    expect(resultado).toEqual([{ loteId: 'l1', nombreLote: 'BGPP', neto: 12284.9 }]);
  });

  it('resta la parte que sí tiene producto asignado', () => {
    const resultado = calcularLotesSinDesglose([
      { loteId: 'l1', nombreLote: 'BGPP', stockTotalAlmacen: 19490.5, stockPorProducto: [102.9] },
    ]);
    expect(resultado).toHaveLength(1);
    expect(resultado[0].neto).toBeCloseTo(19387.6, 5);
  });

  it('omite lotes sin resto (ruido de redondeo) y lotes vacíos', () => {
    const resultado = calcularLotesSinDesglose([
      { loteId: 'l1', nombreLote: 'A', stockTotalAlmacen: 100, stockPorProducto: [60, 40.001] },
      { loteId: 'l2', nombreLote: 'B', stockTotalAlmacen: 0, stockPorProducto: [] },
    ]);
    expect(resultado).toEqual([]);
  });

  it('conserva un resto negativo para que no se oculte un faltante real', () => {
    const resultado = calcularLotesSinDesglose([
      { loteId: 'l1', nombreLote: 'A', stockTotalAlmacen: 10, stockPorProducto: [15] },
    ]);
    expect(resultado).toEqual([{ loteId: 'l1', nombreLote: 'A', neto: -5 }]);
  });
});
