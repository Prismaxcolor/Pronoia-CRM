import { describe, it, expect } from 'vitest';
import {
  distribuirSalidasTransformacion,
  type EntradaTransformacionInventario,
  type SalidaTransformacionInventario,
  type ContextoDistribucionSalidas,
  type MovimientoInventario,
} from '../src/services/inventario-service.js';

const ctxBase = (extra: Partial<ContextoDistribucionSalidas> = {}): ContextoDistribucionSalidas => ({
  idsPermitidos: new Set(['pA', 'pB', 'pX']),
  loteEnAlmacen: (_id: string | null) => true,
  ...extra,
});

const salida = (o: Partial<SalidaTransformacionInventario>): SalidaTransformacionInventario => ({
  transformacionId: 't1',
  productoId: null,
  loteDestinoId: null,
  nombreLote: null,
  almacenId: null,
  almacenTransformacionId: 'alm1',
  estadoTransformacion: 'completa',
  fecha: '2026-09-01',
  pesoNeto: 0,
  ...o,
});

const entradas = (rows: EntradaTransformacionInventario[], id = 't1') => new Map([[id, rows]]);

/** Réplica de la lógica anterior (material ferroso suelto + lote por herencia):
 *  referencia para comprobar que los datos actuales no cambian. */
function referenciaAnterior(
  filas: SalidaTransformacionInventario[],
  ent: Map<string, EntradaTransformacionInventario[]>,
  ctx: ContextoDistribucionSalidas
): { entradas: MovimientoInventario[]; sinProducto: Array<[string, number]> } {
  const out: MovimientoInventario[] = [];
  for (const d of filas.filter(f => f.productoId)) {
    if (!ctx.idsPermitidos.has(d.productoId!)) continue;
    out.push({ productoId: d.productoId!, destinoTipo: 'mpp', loteId: null, destinoLabel: 'Sin lote', peso: d.pesoNeto });
  }
  const sp = new Map<string, number>();
  for (const s of filas.filter(f => f.loteDestinoId)) {
    const rows = ent.get(s.transformacionId) ?? [];
    const total = rows.reduce((a, r) => a + r.pesoKg, 0);
    if (total <= 0) continue;
    for (const r of rows) {
      if (!r.productoId || !ctx.idsPermitidos.has(r.productoId)) continue;
      out.push({ productoId: r.productoId, destinoTipo: 'lote', loteId: s.loteDestinoId, destinoLabel: s.nombreLote ?? 'Lote', peso: (s.pesoNeto * r.pesoKg) / total });
    }
    const sin = rows.filter(r => !r.productoId).reduce((a, r) => a + r.pesoKg, 0);
    if (sin > 0) sp.set(s.loteDestinoId!, (sp.get(s.loteDestinoId!) ?? 0) + (s.pesoNeto * sin) / total);
  }
  return { entradas: out, sinProducto: [...sp.entries()] };
}

describe('distribuirSalidasTransformacion', () => {
  it('A: material suelto cuenta en el almacén de la salida o, si no tiene, el de la transformación', () => {
    const filas = [
      salida({ productoId: 'pA', pesoNeto: 10, almacenId: 'almSalida' }),
      salida({ productoId: 'pB', pesoNeto: 5 }),
    ];
    const todos = distribuirSalidasTransformacion(filas, entradas([]), ctxBase());
    expect(todos.entradas).toHaveLength(2);
    expect(todos.entradas.every(e => e.destinoTipo === 'mpp' && e.loteId === null)).toBe(true);

    const enSalida = distribuirSalidasTransformacion(filas, entradas([]), ctxBase({ almacenId: 'almSalida' }));
    expect(enSalida.entradas.map(e => e.productoId)).toEqual(['pA']);
    const enTransf = distribuirSalidasTransformacion(filas, entradas([]), ctxBase({ almacenId: 'alm1' }));
    expect(enTransf.entradas.map(e => e.productoId)).toEqual(['pB']);
  });

  it('A: solo cuenta con la transformación completa', () => {
    const pendiente = salida({ productoId: 'pA', pesoNeto: 10, estadoTransformacion: 'bruto' });
    expect(distribuirSalidasTransformacion([pendiente], entradas([]), ctxBase()).entradas).toEqual([]);
  });

  it('B: lote sin producto hereda la composición de entrada proporcionalmente', () => {
    const ent = entradas([
      { productoId: 'pA', pesoKg: 60 },
      { productoId: 'pB', pesoKg: 30 },
      { productoId: null, pesoKg: 10 },
    ]);
    const r = distribuirSalidasTransformacion(
      [salida({ loteDestinoId: 'L1', nombreLote: 'Lote 1', pesoNeto: 50 })],
      ent,
      ctxBase()
    );
    expect(r.entradas).toEqual([
      { productoId: 'pA', destinoTipo: 'lote', loteId: 'L1', destinoLabel: 'Lote 1', peso: 30 },
      { productoId: 'pB', destinoTipo: 'lote', loteId: 'L1', destinoLabel: 'Lote 1', peso: 15 },
    ]);
    expect(r.sinProductoPorLote.get('L1')).toEqual({ nombreLote: 'Lote 1', monto: 5 });
  });

  it('C: producto + lote entra directo, sin heredar la composición de entrada', () => {
    const ent = entradas([{ productoId: 'pB', pesoKg: 100 }]);
    const r = distribuirSalidasTransformacion(
      [salida({ productoId: 'pX', loteDestinoId: 'L2', nombreLote: 'Lote 2', pesoNeto: 40, almacenId: 'almX' })],
      ent,
      ctxBase()
    );
    expect(r.entradas).toEqual([
      { productoId: 'pX', destinoTipo: 'lote', loteId: 'L2', destinoLabel: 'Lote 2', peso: 40 },
    ]);
    expect(r.sinProductoPorLote.size).toBe(0);
  });

  it('C: ignora productos fuera del catálogo filtrado', () => {
    const r = distribuirSalidasTransformacion(
      [salida({ productoId: 'otro', loteDestinoId: 'L2', pesoNeto: 40 })],
      entradas([]),
      ctxBase()
    );
    expect(r.entradas).toEqual([]);
  });

  it('respeta el rango de fechas', () => {
    const f = salida({ productoId: 'pA', pesoNeto: 1, fecha: '2026-09-01' });
    expect(distribuirSalidasTransformacion([f], entradas([]), ctxBase({ desde: '2026-09-02' })).entradas).toEqual([]);
    expect(distribuirSalidasTransformacion([f], entradas([]), ctxBase({ hasta: '2026-08-31' })).entradas).toEqual([]);
    expect(distribuirSalidasTransformacion([f], entradas([]), ctxBase({ desde: '2026-09-01', hasta: '2026-09-01' })).entradas).toHaveLength(1);
  });

  it('mixta: A, B y C en una misma transformación', () => {
    const ent = entradas([{ productoId: 'pA', pesoKg: 100 }]);
    const r = distribuirSalidasTransformacion(
      [
        salida({ loteDestinoId: 'L1', nombreLote: 'L1', pesoNeto: 20 }),
        salida({ productoId: 'pB', pesoNeto: 7 }),
        salida({ productoId: 'pX', loteDestinoId: 'L2', pesoNeto: 3 }),
      ],
      ent,
      ctxBase()
    );
    expect(r.entradas.map(e => [e.productoId, e.destinoTipo, e.loteId, e.peso])).toEqual([
      ['pB', 'mpp', null, 7],
      ['pA', 'lote', 'L1', 20],
      ['pX', 'lote', 'L2', 3],
    ]);
  });

  it('datos actuales (ferroso material + PCB/legacy a lote) dan lo mismo que la lógica anterior', () => {
    const ent = new Map<string, EntradaTransformacionInventario[]>([
      ['t1', [{ productoId: 'pA', pesoKg: 70 }, { productoId: null, pesoKg: 30 }]],
      ['t2', [{ productoId: 'pB', pesoKg: 10 }]],
    ]);
    const filas = [
      salida({ transformacionId: 't3', productoId: 'pA', pesoNeto: 12.5 }),
      salida({ transformacionId: 't3', productoId: 'pB', pesoNeto: 3.25 }),
      salida({ transformacionId: 't1', loteDestinoId: 'L1', nombreLote: 'L1', pesoNeto: 33.3 }),
      salida({ transformacionId: 't1', loteDestinoId: 'L2', nombreLote: 'L2', almacenId: 'almZ', pesoNeto: 10 }),
      salida({ transformacionId: 't2', loteDestinoId: 'L1', nombreLote: 'L1', pesoNeto: 4 }),
    ];
    const ctx = ctxBase();
    const nuevo = distribuirSalidasTransformacion(filas, ent, ctx);
    const viejo = referenciaAnterior(filas, ent, ctx);
    expect(nuevo.entradas).toEqual(viejo.entradas);
    expect([...nuevo.sinProductoPorLote].map(([k, v]) => [k, v.monto])).toEqual(viejo.sinProducto);
  });
});
