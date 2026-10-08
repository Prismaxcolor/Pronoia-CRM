import { describe, it, expect } from 'vitest';
import {
  calcularMerma,
  claveDePeriodo,
  construirFilaMerma,
  resumirMerma,
  filtrarPorProducto,
  type TransformacionParaMerma,
} from '../src/utils/merma-transformacion.js';

function trans(p: Partial<TransformacionParaMerma> & { id: string; fecha: string; pesoNeto: number; salidas: number[] }): TransformacionParaMerma {
  return {
    numero: 1,
    codigo: 'TR-0001',
    categoria: 'ferroso_no_ferroso',
    almacenId: 'a1',
    productoEntradaId: 'p1',
    nombreProductoEntrada: 'Cobre',
    nombreLoteOrigen: null,
    entradaDetalle: [],
    ...p,
    salidas: p.salidas.map(n => ({ pesoNeto: n })),
  };
}

describe('calcularMerma', () => {
  it('merma = entrada neta - suma de salidas, con porcentaje', () => {
    expect(calcularMerma(22.8, [21.445])).toEqual({ kgMerma: 1.355, pctMerma: 5.94 });
  });
  it('sin salidas toda la entrada es merma', () => {
    expect(calcularMerma(10, [])).toEqual({ kgMerma: 10, pctMerma: 100 });
  });
  it('entrada cero no divide por cero', () => {
    expect(calcularMerma(0, [])).toEqual({ kgMerma: 0, pctMerma: 0 });
  });
  it('evita ruido de coma flotante', () => {
    expect(calcularMerma(0.3, [0.1, 0.2]).kgMerma).toBe(0);
  });
  it('conserva el signo negativo si las salidas exceden la entrada', () => {
    expect(calcularMerma(10, [10.005]).kgMerma).toBe(-0.005);
  });
});

describe('claveDePeriodo', () => {
  it('dia devuelve la misma fecha', () => {
    expect(claveDePeriodo('2026-10-02', 'dia')).toBe('2026-10-02');
  });
  it('mes devuelve el primer dia del mes', () => {
    expect(claveDePeriodo('2026-09-28', 'mes')).toBe('2026-09-01');
  });
  it('semana devuelve el lunes de esa semana', () => {
    // 2026-10-02 es viernes -> lunes 2026-09-28
    expect(claveDePeriodo('2026-10-02', 'semana')).toBe('2026-09-28');
    // un lunes se queda igual, un domingo retrocede 6 dias
    expect(claveDePeriodo('2026-09-28', 'semana')).toBe('2026-09-28');
    expect(claveDePeriodo('2026-10-04', 'semana')).toBe('2026-09-28');
  });
  it('semana cruza el cambio de año', () => {
    expect(claveDePeriodo('2027-01-01', 'semana')).toBe('2026-12-28');
  });
});

describe('construirFilaMerma', () => {
  it('usa el nombre del lote origen cuando no hay producto (PCB)', () => {
    const f = construirFilaMerma(trans({ id: 't', fecha: '2026-10-01', pesoNeto: 10, salidas: [9], productoEntradaId: null, nombreProductoEntrada: null, nombreLoteOrigen: 'Lote PCB 1' }));
    expect(f.entrada).toBe('Lote PCB 1');
    expect(f.kgMerma).toBe(1);
    expect(f.pctMerma).toBe(10);
  });
  it('suma salidas mixtas (materiales y lotes) por igual', () => {
    const f = construirFilaMerma(trans({ id: 't', fecha: '2026-10-01', pesoNeto: 100, salidas: [40, 30, 20] }));
    expect(f.kgSalida).toBe(90);
    expect(f.kgMerma).toBe(10);
  });
});

describe('resumirMerma', () => {
  const filas = [
    construirFilaMerma(trans({ id: 'a', fecha: '2026-09-28', pesoNeto: 22.8, salidas: [21.445] })),
    construirFilaMerma(trans({ id: 'b', fecha: '2026-09-30', pesoNeto: 100, salidas: [100] })),
    construirFilaMerma(trans({ id: 'c', fecha: '2026-10-02', pesoNeto: 10, salidas: [9] })),
  ];
  it('totales: porcentaje sobre la entrada total, no promedio de porcentajes', () => {
    const { totales } = resumirMerma(filas, 'mes');
    expect(totales).toEqual({ transformaciones: 3, kgEntrada: 132.8, kgSalida: 130.445, kgMerma: 2.355, pctMerma: 1.77 });
  });
  it('agrupa por mes ordenado ascendente', () => {
    const { periodos } = resumirMerma(filas, 'mes');
    expect(periodos.map(p => p.periodo)).toEqual(['2026-09-01', '2026-10-01']);
    expect(periodos[0]).toMatchObject({ transformaciones: 2, kgEntrada: 122.8, kgMerma: 1.355 });
    expect(periodos[1]).toMatchObject({ transformaciones: 1, kgEntrada: 10, kgMerma: 1, pctMerma: 10 });
  });
  it('agrupa por semana', () => {
    const { periodos } = resumirMerma(filas, 'semana');
    expect(periodos.map(p => p.periodo)).toEqual(['2026-09-28']);
    expect(periodos[0].transformaciones).toBe(3);
  });
  it('lista vacia da totales en cero', () => {
    const r = resumirMerma([], 'dia');
    expect(r.periodos).toEqual([]);
    expect(r.totales.pctMerma).toBe(0);
  });
});

describe('filtrarPorProducto', () => {
  const a = trans({ id: 'a', fecha: '2026-10-01', pesoNeto: 1, salidas: [1], productoEntradaId: 'p1' });
  const b = trans({ id: 'b', fecha: '2026-10-01', pesoNeto: 1, salidas: [1], productoEntradaId: null, entradaDetalle: [{ productoId: 'p2' }] });
  it('coincide por producto de entrada o por detalle de entrada (PCB)', () => {
    expect(filtrarPorProducto([a, b], 'p1').map(t => t.id)).toEqual(['a']);
    expect(filtrarPorProducto([a, b], 'p2').map(t => t.id)).toEqual(['b']);
  });
  it('sin productoId devuelve todo', () => {
    expect(filtrarPorProducto([a, b], undefined)).toHaveLength(2);
  });
});
