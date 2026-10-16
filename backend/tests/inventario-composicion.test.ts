import { describe, it, expect } from 'vitest';
import {
  calcularSinDetalle,
  claveComposicion,
  composicionVacia,
  ordenarYCalcularPct,
  TEXTO_APROXIMADO_ESTANDAR,
  textoAvisoAproximado,
  totalizarComposicion,
  type ItemComposicion,
} from '../../frontend/src/lib/inventario-composicion';

const item = (producto: string, kgActual: number, kgCompradoPeriodo = 0): ItemComposicion => ({
  productoId: producto, producto, categoria: 'PCB', kgActual, kgCompradoPeriodo,
});

describe('claveComposicion', () => {
  it('distingue lote, fechas y almacén', () => {
    const base = claveComposicion('L1', { desde: '2026-09-01', hasta: '2026-09-30' });
    expect(claveComposicion('L2', { desde: '2026-09-01', hasta: '2026-09-30' })).not.toBe(base);
    expect(claveComposicion('L1', { desde: '2026-09-02', hasta: '2026-09-30' })).not.toBe(base);
    expect(claveComposicion('L1', { desde: '2026-09-01', hasta: '2026-09-30', almacenId: 'A' })).not.toBe(base);
    expect(claveComposicion('L1', { desde: '2026-09-01', hasta: '2026-09-30' })).toBe(base);
  });
});

describe('ordenarYCalcularPct', () => {
  it('ordena por kg actual descendente y calcula el porcentaje', () => {
    const r = ordenarYCalcularPct([item('Memoria', 25), item('Teléfonos', 75)]);
    expect(r.map(i => i.producto)).toEqual(['Teléfonos', 'Memoria']);
    expect(r[0].pct).toBeCloseTo(75);
    expect(r[1].pct).toBeCloseTo(25);
  });
  it('con total cero devuelve 0 % sin dividir entre cero', () => {
    expect(ordenarYCalcularPct([item('A', 0, 5)])[0].pct).toBe(0);
  });
  it('no modifica la lista original y tolera valores no numéricos', () => {
    const original = [item('B', 1), { ...item('A', 2), kgActual: Number.NaN }];
    const copia = JSON.stringify(original);
    const r = ordenarYCalcularPct(original);
    expect(JSON.stringify(original)).toBe(copia);
    expect(r.find(i => i.producto === 'A')?.kgActual).toBe(0);
  });
  it('desempata por nombre', () => {
    expect(ordenarYCalcularPct([item('Zeta', 5), item('Alfa', 5)]).map(i => i.producto)).toEqual(['Alfa', 'Zeta']);
  });
});

describe('totalizarComposicion', () => {
  it('suma kg actuales y comprados', () => {
    expect(totalizarComposicion([item('A', 10, 4), item('B', 5.5, 1)])).toEqual({ kgActual: 15.5, kgCompradoPeriodo: 5 });
  });
});

describe('textoAvisoAproximado', () => {
  it('usa la nota del backend o el texto estándar', () => {
    expect(textoAvisoAproximado('  Nota propia ')).toBe('Nota propia');
    expect(textoAvisoAproximado(null)).toBe(TEXTO_APROXIMADO_ESTANDAR);
    expect(textoAvisoAproximado('   ')).toBe(TEXTO_APROXIMADO_ESTANDAR);
  });
});

describe('composicionVacia', () => {
  it('detecta lotes sin material', () => {
    expect(composicionVacia([])).toBe(true);
    expect(composicionVacia([item('A', 0, 0)])).toBe(true);
    expect(composicionVacia([item('A', 0, 3)])).toBe(false);
  });
});

describe('calcularSinDetalle', () => {
  it('calcula los kilos sin producto y su porcentaje', () => {
    const r = calcularSinDetalle(32323, 651);
    expect(r?.kg).toBe(31672);
    expect(r?.pct).toBeCloseTo(97.99, 1);
    expect(r?.esAlto).toBe(true);
  });
  it('no avisa con menos de 20 % y no muestra por debajo de 0,05 kg', () => {
    expect(calcularSinDetalle(100, 90)?.esAlto).toBe(false);
    expect(calcularSinDetalle(100, 99.97)).toBeNull();
  });
  it('sin dato del lote devuelve null; lote sin productos es todo sin detalle', () => {
    expect(calcularSinDetalle(undefined, 5)).toBeNull();
    expect(calcularSinDetalle(0, 0)).toBeNull();
    expect(calcularSinDetalle(50, 0)?.pct).toBe(100);
  });
});

describe('ordenarYCalcularPct con base', () => {
  it('usa los kg del lote como base del porcentaje', () => {
    expect(ordenarYCalcularPct([item('A', 25)], 100)[0].pct).toBeCloseTo(25);
  });
});
