import { describe, it, expect } from 'vitest';
import {
  acumuladoPorDia, etiquetasEjeX, indiceBajoCursor, indiceTrasTecla, indicesEtiquetasX, mismoRango, serieComparacion, terminaHoy, totalCurva,
} from '../../frontend/src/features/wallet/estadisticas/estadisticas-curvas';
import type { MovUsd } from '../../frontend/src/features/wallet/estadisticas/estadisticas-logica';
import { rutaAreaSuave, rutaCurvaSuave, rutaLinea } from '../../frontend/src/lib/graficas';
import { rangoDePeriodo, rangoMismoPeriodoAnioPasado, rangoPeriodoAnterior } from '../../frontend/src/features/wallet/wallet-periodos';

let n = 0;
const mu = (dia: string, usd: number): MovUsd => ({
  id: `m${++n}`, dia, usd, categoriaId: null, bancaId: 'b1', descripcion: '', proveedorId: null, clienteId: null, subtipo: null,
});
const rango = { desde: '2026-11-01', hasta: '2026-11-05' };

describe('acumuladoPorDia', () => {
  const flujo = { ingresos: [mu('2026-11-01', 100), mu('2026-11-04', 50)], egresos: [mu('2026-11-02', 30), mu('2026-11-02', 10)] };
  it('flujo = ingresos - gastos acumulado día a día', () => {
    expect(acumuladoPorDia(rango, flujo, 'flujo')).toEqual([100, 60, 60, 110, 110]);
  });
  it('gastos e ingresos acumulan solo su lado, en positivo', () => {
    expect(acumuladoPorDia(rango, flujo, 'gastos')).toEqual([0, 40, 40, 40, 40]);
    expect(acumuladoPorDia(rango, flujo, 'ingresos')).toEqual([100, 100, 100, 150, 150]);
  });
  it('ignora lo que cae fuera del rango', () => {
    const f = { ingresos: [mu('2026-10-31', 999), mu('2026-11-06', 999)], egresos: [] };
    expect(acumuladoPorDia(rango, f, 'ingresos')).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('serieComparacion', () => {
  const actual = { rango, flujo: { ingresos: [mu('2026-11-01', 10), mu('2026-11-05', 10)], egresos: [] } };
  const rAnt = { desde: '2026-10-27', hasta: '2026-10-31' };
  const anterior = { rango: rAnt, flujo: { ingresos: [mu('2026-10-27', 5)], egresos: [] } };
  it('alinea por posición del día y deja null donde no hay curva (nunca ceros inventados)', () => {
    const s = serieComparacion({ actual, anterior, anioPasado: null, metrica: 'ingresos' });
    expect(s.map(p => p.actual)).toEqual([10, 10, 10, 10, 20]);
    expect(s.map(p => p.anterior)).toEqual([5, 5, 5, 5, 5]);
    expect(s.every(p => p.anioPasado === null)).toBe(true);
    expect(s[0].dia).toBe('2026-11-01');
    expect(s[0].etiqueta).toBe('01/11');
  });
  it('sin período anterior la curva anterior es null en todos los puntos', () => {
    const s = serieComparacion({ actual, anterior: null, anioPasado: null, metrica: 'flujo' });
    expect(s.every(p => p.anterior === null && p.anioPasado === null)).toBe(true);
  });
  it('un período más corto deja null al final en vez de repetir o poner cero', () => {
    const corto = { rango: { desde: '2026-10-29', hasta: '2026-10-31' }, flujo: { ingresos: [], egresos: [] } };
    const s = serieComparacion({ actual, anterior: corto, anioPasado: null, metrica: 'ingresos' });
    expect(s.map(p => p.anterior)).toEqual([0, 0, 0, null, null]);
  });
  it('el total de la curva es el último valor acumulado', () => {
    const s = serieComparacion({ actual, anterior: null, anioPasado: null, metrica: 'ingresos' });
    expect(totalCurva(s)).toBe(20);
    expect(totalCurva([])).toBe(0);
  });
});

describe('rangoMismoPeriodoAnioPasado', () => {
  it('mueve el final 12 meses atrás y conserva la cantidad de días', () => {
    const r = rangoDePeriodo('30D', new Date('2026-11-11T00:00:00Z'));
    expect(rangoMismoPeriodoAnioPasado(r)).toEqual({ desde: '2025-10-13', hasta: '2025-11-11' });
  });
  it('no desborda el 29 de febrero', () => {
    expect(rangoMismoPeriodoAnioPasado({ desde: '2024-02-23', hasta: '2024-02-29' })).toEqual({ desde: '2023-02-22', hasta: '2023-02-28' });
  });
  it('en 1A coincide con el período anterior (por eso no se dibuja dos veces)', () => {
    const r = rangoDePeriodo('1A', new Date('2026-11-11T00:00:00Z'));
    expect(mismoRango(rangoMismoPeriodoAnioPasado(r), rangoPeriodoAnterior(r))).toBe(true);
    const r6 = rangoDePeriodo('6M', new Date('2026-11-11T00:00:00Z'));
    expect(mismoRango(rangoMismoPeriodoAnioPasado(r6), rangoPeriodoAnterior(r6))).toBe(false);
  });
});

describe('eje X', () => {
  it('siempre incluye el primero y el último, sin pisarse', () => {
    expect(indicesEtiquetasX(7, 7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(indicesEtiquetasX(30, 7)).toEqual([0, 5, 10, 15, 20, 25, 29]);
    expect(indicesEtiquetasX(32, 7)).toEqual([0, 6, 12, 18, 24, 31]);
    expect(indicesEtiquetasX(1, 7)).toEqual([0]);
    expect(indicesEtiquetasX(0, 7)).toEqual([]);
  });
  it('rotula "Hoy" el último tramo solo si el rango termina hoy', () => {
    expect(etiquetasEjeX(['01/11', '02/11'], 'dia', true)).toEqual(['01/11', 'Hoy']);
    expect(etiquetasEjeX(['01/11', '02/11'], 'dia', false)).toEqual(['01/11', '02/11']);
    expect(etiquetasEjeX(['a', 'b'], 'semana', true)[1]).toBe('Esta semana');
    expect(etiquetasEjeX(['a', 'b'], 'mes', true)[1]).toBe('Este mes');
    expect(etiquetasEjeX([], 'dia', true)).toEqual([]);
  });
  it('terminaHoy compara el último día del rango', () => {
    expect(terminaHoy(rango, '2026-11-05')).toBe(true);
    expect(terminaHoy(rango, '2026-11-06')).toBe(false);
  });
});

describe('cursor', () => {
  it('encuentra el punto más cercano a la posición', () => {
    expect(indiceBajoCursor([10, 20, 30], 26)).toBe(2);
    expect(indiceBajoCursor([10, 20, 30], -50)).toBe(0);
    expect(indiceBajoCursor([], 5)).toBeNull();
  });
  it('el teclado mueve el cursor sin salirse de la serie', () => {
    expect(indiceTrasTecla(null, 'ArrowRight', 5)).toBe(0);
    expect(indiceTrasTecla(null, 'ArrowLeft', 5)).toBe(4);
    expect(indiceTrasTecla(4, 'ArrowRight', 5)).toBe(4);
    expect(indiceTrasTecla(0, 'ArrowLeft', 5)).toBe(0);
    expect(indiceTrasTecla(2, 'Home', 5)).toBe(0);
    expect(indiceTrasTecla(2, 'End', 5)).toBe(4);
    expect(indiceTrasTecla(2, 'Escape', 5)).toBeNull();
    expect(indiceTrasTecla(2, 'a', 5)).toBe(2);
    expect(indiceTrasTecla(2, 'End', 0)).toBeNull();
  });
});

describe('curva suave (Catmull-Rom)', () => {
  const pts = [{ x: 0, y: 10 }, { x: 10, y: 0 }, { x: 20, y: 10 }, { x: 30, y: 10 }];
  it('con menos de 3 puntos es una polilínea', () => {
    expect(rutaCurvaSuave([{ x: 0, y: 1 }, { x: 5, y: 2 }])).toBe(rutaLinea([{ x: 0, y: 1 }, { x: 5, y: 2 }]));
    expect(rutaCurvaSuave([])).toBe('');
  });
  it('pasa por todos los puntos y usa un tramo cúbico por segmento', () => {
    const d = rutaCurvaSuave(pts);
    expect(d.startsWith('M0 10')).toBe(true);
    expect(d.match(/C/g)).toHaveLength(3);
    expect(d.endsWith('30 10')).toBe(true);
  });
  it('los puntos de control no se salen verticalmente del tramo (sin picos bajo cero entre ceros)', () => {
    const planos = [{ x: 0, y: 100 }, { x: 10, y: 100 }, { x: 20, y: 40 }, { x: 30, y: 100 }];
    const ys = [...rutaCurvaSuave(planos).matchAll(/C[\d.]+ ([\d.]+) [\d.]+ ([\d.]+)/g)].flatMap(m => [Number(m[1]), Number(m[2])]);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(40);
  });
  it('el área cierra hasta la base', () => {
    const d = rutaAreaSuave(pts, 50);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).toContain('L30 50 L0 50');
    expect(rutaAreaSuave([], 5)).toBe('');
  });
});
