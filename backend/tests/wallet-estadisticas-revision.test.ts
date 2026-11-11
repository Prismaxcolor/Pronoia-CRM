import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Movimiento } from '../../shared/types/index.js';
import { MONTO_OCULTO } from '../../frontend/src/features/wallet/wallet-grupos';
import { COLOR_SIN_CATEGORIA, textoRegistros, type FilaCategoria, type MovUsd } from '../../frontend/src/features/wallet/estadisticas/estadisticas-logica';
import {
  agruparPorContraparte, formatearMontoFila, rutaDeFila,
} from '../../frontend/src/features/wallet/estadisticas/estadisticas-gastos';
import { rutaRegistros } from '../../frontend/src/features/wallet/estadisticas/estadisticas-enlaces';
import {
  COLOR_OTROS, diferenciarColores, porcionesDonaW,
} from '../../frontend/src/features/wallet/estadisticas/estadisticas-dona';
import {
  MAX_MOVIMIENTOS_GUARDADOS, recortarMovimientosGuardados, textoDatosGuardados,
} from '../../frontend/src/features/wallet/estadisticas/estadisticas-datos';
import {
  ANCHO_CARACTER_ETIQUETA, esTeclaDeCursor, indicesEtiquetasLegibles,
} from '../../frontend/src/features/wallet/estadisticas/estadisticas-curvas';
import { soloCuentasActivas } from '../../frontend/src/features/wallet/estadisticas/estadisticas-saldos';
import { usaPeriodo } from '../../frontend/src/features/wallet/estadisticas/estadisticas-tabs';
import { conTiempoMaximo, ErrorTiempoAgotado } from '../../frontend/src/features/wallet/estadisticas/estadisticas-compartir';
import { rutaCurvaMonotona, rutaAreaMonotona } from '../../frontend/src/lib/graficas';

const fila = (extra: Partial<FilaCategoria>): FilaCategoria => ({
  id: 'x', clave: 'x', nombre: 'X', color: '#112233', usd: 10, cantidad: 1, hijas: [], variacion: null, ...extra,
});
const mu = (extra: Partial<MovUsd>): MovUsd => ({
  id: 'm', dia: '2026-11-05', usd: 10, categoriaId: null, bancaId: 'b1', descripcion: '', proveedorId: null, clienteId: null, subtipo: null, ...extra,
});

// ---------------------------------------------------------------- 1. privacidad por cuenta

describe('formatearMontoFila (el monto atado a UNA cuenta respeta su ojo cerrado)', () => {
  const fmt = (m: number) => `USD ${m}`;
  const fmtCuenta = (id: string, m: number) => (id === 'oculta' ? MONTO_OCULTO : `USD ${m}`);
  it('con la agrupación por cuenta usa el formateo de esa cuenta', () => {
    expect(formatearMontoFila('cuenta', fila({ id: 'oculta' }), fmt, fmtCuenta)).toBe(MONTO_OCULTO);
    expect(formatearMontoFila('cuenta', fila({ id: 'b1' }), fmt, fmtCuenta)).toBe('USD 10');
  });
  it('las demás agrupaciones mezclan cuentas: usan el formateo general', () => {
    expect(formatearMontoFila('categoria', fila({ id: 'oculta' }), fmt, fmtCuenta)).toBe('USD 10');
    expect(formatearMontoFila('contraparte', fila({ id: 'oculta' }), fmt, fmtCuenta)).toBe('USD 10');
  });
  it('una fila de cuenta sin id cae en el formateo general', () => {
    expect(formatearMontoFila('cuenta', fila({ id: null }), fmt, fmtCuenta)).toBe('USD 10');
  });
});

describe('porcionesDonaW', () => {
  it('ordena, calcula % y marca como oculta la porción de una cuenta oculta', () => {
    const p = porcionesDonaW([
      { etiqueta: 'A', valor: 30, color: '#111111', oculto: true },
      { etiqueta: 'B', valor: 70, color: '#EE2222' },
    ]);
    expect(p.map(x => [x.etiqueta, x.pct, x.oculto])).toEqual([['B', 70, false], ['A', 30, true]]);
  });
  it('agrupa el resto en "Otros" (al final) y queda oculto si algo de lo agrupado lo estaba', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ etiqueta: `c${i}`, valor: 100 - i, color: '#2563EB', oculto: i === 9 }));
    const p = porcionesDonaW(items, 8);
    expect(p).toHaveLength(9);
    const otros = p[p.length - 1];
    expect(otros.etiqueta).toBe('Otros');
    expect(otros.esOtros).toBe(true);
    expect(otros.valor).toBe(183);
    expect(otros.oculto).toBe(true);
    expect(otros.color).toBe(COLOR_OTROS);
  });
  it('"Otros" visible si nada de lo agrupado estaba oculto; ignora valores <= 0 y total 0', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ etiqueta: `c${i}`, valor: 10 + i, color: '#2563EB' }));
    expect(porcionesDonaW(items, 8).at(-1)?.oculto).toBe(false);
    expect(porcionesDonaW([{ etiqueta: 'a', valor: 0, color: '#000000' }])).toEqual([]);
  });
});

// ---------------------------------------------------------------- 6. colores distinguibles

describe('diferenciarColores', () => {
  const protegidos = [COLOR_SIN_CATEGORIA, COLOR_OTROS];
  const dist = (a: string, b: string): number => {
    const n = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const [x, y] = [n(a), n(b)];
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
  };
  it('"Sin categoría" y "Otros" son neutros distintos entre sí', () => {
    expect(dist(COLOR_SIN_CATEGORIA, COLOR_OTROS)).toBeGreaterThan(60);
  });
  it('un color casi igual a un neutro reservado se reemplaza por uno distinguible', () => {
    const r = diferenciarColores([COLOR_SIN_CATEGORIA, '#707680', COLOR_OTROS], protegidos);
    expect(r[0]).toBe(COLOR_SIN_CATEGORIA);
    expect(r[2]).toBe(COLOR_OTROS);
    expect(dist(r[1], COLOR_SIN_CATEGORIA)).toBeGreaterThan(60);
    expect(dist(r[1], COLOR_OTROS)).toBeGreaterThan(60);
  });
  it('dos categorías con el mismo color: la segunda cambia', () => {
    const r = diferenciarColores(['#2563EB', '#2563EB'], protegidos);
    expect(r[0]).toBe('#2563EB');
    expect(dist(r[0], r[1])).toBeGreaterThan(60);
  });
  it('deja intactos los colores ya distinguibles y los que no son hexadecimales', () => {
    expect(diferenciarColores(['#DC2626', '#2563EB', 'var(--color-w-acento)'], protegidos)).toEqual(['#DC2626', '#2563EB', 'var(--color-w-acento)']);
  });
  it('no muta la lista recibida', () => {
    const entrada = ['#707680'];
    diferenciarColores(entrada, protegidos);
    expect(entrada).toEqual(['#707680']);
  });
});

// ---------------------------------------------------------------- 2. datos guardados

describe('datos guardados de movimientos', () => {
  const mov = (i: number): Movimiento => ({ id: `m${i}`, fecha: new Date(2026, 0, 1 + i).toISOString() } as unknown as Movimiento);
  it('recorta igual que Registros: las últimas 200 por fecha, sin mutar', () => {
    const todos = Array.from({ length: 250 }, (_, i) => mov(i));
    const r = recortarMovimientosGuardados({ movimientos: todos });
    expect(MAX_MOVIMIENTOS_GUARDADOS).toBe(200);
    expect(r.movimientos).toHaveLength(200);
    expect(r.movimientos[0].id).toBe('m249');
    expect(todos).toHaveLength(250);
  });
  it('el aviso dice la fecha y hora de la copia y el límite', () => {
    const t = new Date(2026, 10, 11, 9, 5).getTime();
    const texto = textoDatosGuardados(t);
    expect(texto).toBe('Estás viendo datos guardados (del 11/11/2026 09:05) y solo incluyen los últimos 200 movimientos; los totales pueden estar incompletos.');
  });
});

// ---------------------------------------------------------------- 4. enlaces coherentes con Registros

describe('enlaces hacia Registros', () => {
  it('siempre piden ocultar los anulados, antes del período', () => {
    expect(rutaRegistros({ cat: 'c1', tipo: 'egreso', periodo: '30D' })).toBe('/wallet/registros?cat=c1&tipo=egreso&sinanulados=1&p=30D');
    expect(rutaRegistros({ banca: 'b1', periodo: '7D' })).toBe('/wallet/registros?banca=b1&sinanulados=1&p=7D');
  });
  it('las filas de Gastos agregan tipo=egreso', () => {
    expect(rutaDeFila('categoria', { id: 'c1', clave: 'c1' }, '30D')).toBe('/wallet/registros?cat=c1&tipo=egreso&sinanulados=1&p=30D');
    expect(rutaDeFila('cuenta', { id: 'b1', clave: 'b1' }, '6M')).toBe('/wallet/registros?banca=b1&tipo=egreso&sinanulados=1&p=6M');
  });
  it('"Sin categoría" abre los egresos sin categoría; "Otra categoría" y proveedor no tienen destino', () => {
    expect(rutaDeFila('categoria', { id: null, clave: 'sin' }, '30D')).toBe('/wallet/registros?cat=sin&tipo=egreso&sinanulados=1&p=30D');
    expect(rutaDeFila('categoria', { id: null, clave: 'otra' }, '30D')).toBeNull();
    expect(rutaDeFila('contraparte', { id: 'p1', clave: 'p1' }, '30D')).toBeNull();
  });
  it('"X (sin subcategoría)" no enlaza: Registros incluiría las subcategorías y "N registros" no coincidiría', () => {
    expect(rutaDeFila('subcategoria', { id: 'p', clave: 'p:directo' }, '30D')).toBeNull();
  });
});

describe('textoRegistros', () => {
  it('singular y plural', () => {
    expect(textoRegistros(0)).toBe('0 registros');
    expect(textoRegistros(1)).toBe('1 registro');
    expect(textoRegistros(2)).toBe('2 registros');
  });
});

// ---------------------------------------------------------------- 7. proveedor / cliente

describe('agruparPorContraparte sin nombre', () => {
  it('rotula Proveedor o Cliente según corresponda', () => {
    const filas = agruparPorContraparte([mu({ proveedorId: 'p1', usd: 9 }), mu({ clienteId: 'c1', usd: 3 })], () => null);
    expect(filas.map(f => f.nombre)).toEqual(['Proveedor', 'Cliente']);
  });
  it('numera por rol cuando hay varios del mismo', () => {
    const filas = agruparPorContraparte([mu({ clienteId: 'c1', usd: 9 }), mu({ clienteId: 'c2', usd: 3 }), mu({ proveedorId: 'p1', usd: 1 })], () => null);
    expect(filas.map(f => f.nombre)).toEqual(['Cliente 1', 'Cliente 2', 'Proveedor']);
  });
});

describe('selector de período', () => {
  it('solo afecta a las pestañas de movimientos (Saldo y Activos son de hoy)', () => {
    expect(usaPeriodo('saldo')).toBe(false);
    expect(usaPeriodo('activos')).toBe(false);
    expect(usaPeriodo('flujo')).toBe(true);
    expect(usaPeriodo('gastos')).toBe(true);
    expect(usaPeriodo('informes')).toBe(true);
  });
});

describe('cuentas archivadas', () => {
  it('soloCuentasActivas deja fuera las archivadas sin mutar la lista', () => {
    const todas = [{ id: 'a', archivada: false }, { id: 'b', archivada: true }, { id: 'c' }] as never[];
    expect(soloCuentasActivas(todas).map((b: { id: string }) => b.id)).toEqual(['a', 'c']);
    expect(todas).toHaveLength(3);
  });
});

// ---------------------------------------------------------------- cursor y eje X

describe('esTeclaDeCursor', () => {
  it('no captura arriba/abajo (el scroll de la página sigue funcionando)', () => {
    expect(esTeclaDeCursor('ArrowUp')).toBe(false);
    expect(esTeclaDeCursor('ArrowDown')).toBe(false);
    for (const t of ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape']) expect(esTeclaDeCursor(t)).toBe(true);
  });
});

describe('indicesEtiquetasLegibles (eje X sin textos pisados)', () => {
  const extremos = (i: number, n: number, etiquetas: string[], xs: number[]): [number, number] => {
    const w = etiquetas[i].length * ANCHO_CARACTER_ETIQUETA;
    return i === 0 ? [xs[i], xs[i] + w] : i === n - 1 ? [xs[i] - w, xs[i]] : [xs[i] - w / 2, xs[i] + w / 2];
  };
  const sinPisarse = (etiquetas: string[], xs: number[], max: number): void => {
    const idx = indicesEtiquetasLegibles(etiquetas, xs, max);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(etiquetas.length - 1);
    for (let k = 1; k < idx.length; k++) {
      const [, finPrevio] = extremos(idx[k - 1], etiquetas.length, etiquetas, xs);
      const [inicio] = extremos(idx[k], etiquetas.length, etiquetas, xs);
      expect(inicio).toBeGreaterThan(finPrevio);
    }
  };
  const xsDe = (n: number): number[] => Array.from({ length: n }, (_, i) => 48 + (i * 580) / Math.max(1, n - 1));
  it('12S: 12 tramos semanales con "Esta semana" al final', () => {
    const e = Array.from({ length: 12 }, (_, i) => `${String(1 + i).padStart(2, '0')}/09`);
    e[11] = 'Esta semana';
    sinPisarse(e, xsDe(12), 7);
  });
  it('1A: 13 meses con "Este mes" al final', () => {
    const e = Array.from({ length: 13 }, (_, i) => `m${i} 25`);
    e[12] = 'Este mes';
    sinPisarse(e, xsDe(13), 7);
  });
  it('30 días y 7 días', () => {
    const d30 = Array.from({ length: 30 }, (_, i) => `${String(1 + i).padStart(2, '0')}/11`);
    d30[29] = 'Hoy';
    sinPisarse(d30, xsDe(30), 7);
    sinPisarse(['05/11', '06/11', '07/11', '08/11', '09/11', '10/11', 'Hoy'], xsDe(7), 7);
  });
  it('listas vacías o de un solo tramo', () => {
    expect(indicesEtiquetasLegibles([], [], 7)).toEqual([]);
    expect(indicesEtiquetasLegibles(['a'], [10], 7)).toEqual([0]);
  });
});

// ---------------------------------------------------------------- 6. curva monótona

describe('rutaCurvaMonotona', () => {
  const ys = (d: string): number[] => [...d.matchAll(/C[\d.-]+ ([\d.-]+) [\d.-]+ ([\d.-]+) /g)].flatMap(m => [Number(m[1]), Number(m[2])]);
  it('con valores constantes (o todo en cero) es una recta: todos los puntos de control a la misma altura', () => {
    const planos = [0, 1, 2, 3, 4].map(i => ({ x: i * 10, y: 100 }));
    expect(new Set(ys(rutaCurvaMonotona(planos)))).toEqual(new Set([100]));
  });
  it('nunca se sale del rango de cada tramo (no cruza el eje entre ceros)', () => {
    const pts = [{ x: 0, y: 100 }, { x: 10, y: 100 }, { x: 20, y: 40 }, { x: 30, y: 100 }, { x: 40, y: 100 }, { x: 50, y: 100 }];
    const d = rutaCurvaMonotona(pts);
    expect(Math.max(...ys(d))).toBeLessThanOrEqual(100);
    expect(Math.min(...ys(d))).toBeGreaterThanOrEqual(40);
    // tramo plano inicial: ambos controles a 100
    expect(ys(d).slice(0, 2)).toEqual([100, 100]);
  });
  it('pasa por todos los puntos; con menos de 3 es polilínea', () => {
    const pts = [{ x: 0, y: 5 }, { x: 10, y: 1 }, { x: 20, y: 9 }];
    const d = rutaCurvaMonotona(pts);
    expect(d.startsWith('M0 5')).toBe(true);
    expect(d.match(/C/g)).toHaveLength(2);
    expect(d.endsWith('20 9')).toBe(true);
    expect(rutaCurvaMonotona([{ x: 0, y: 1 }, { x: 5, y: 2 }])).toBe('M0 1 L5 2');
    expect(rutaCurvaMonotona([])).toBe('');
  });
  it('cada tramo es monótono (un pico se ve como pico, sin sobreimpulso)', () => {
    const pts = [{ x: 0, y: 100 }, { x: 10, y: 20 }, { x: 20, y: 100 }];
    const [c1, c2, c3, c4] = ys(rutaCurvaMonotona(pts));
    for (const y of [c1, c2, c3, c4]) { expect(y).toBeLessThanOrEqual(100); expect(y).toBeGreaterThanOrEqual(20); }
  });
  it('el área cierra hasta la base', () => {
    const d = rutaAreaMonotona([{ x: 0, y: 1 }, { x: 5, y: 2 }, { x: 9, y: 3 }], 50);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).toContain('L9 50 L0 50');
    expect(rutaAreaMonotona([], 5)).toBe('');
  });
});

// ---------------------------------------------------------------- 5. compartir: tiempo máximo

describe('conTiempoMaximo', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('devuelve el resultado si llega a tiempo', async () => {
    await expect(conTiempoMaximo(Promise.resolve(7), 1000)).resolves.toBe(7);
  });
  it('propaga el error original si la promesa falla antes del tiempo', async () => {
    await expect(conTiempoMaximo(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });
  it('rechaza con ErrorTiempoAgotado si tarda más de lo permitido', async () => {
    vi.useFakeTimers();
    const lenta = new Promise<number>(() => { /* nunca resuelve */ });
    const r = conTiempoMaximo(lenta, 5000);
    const esperado = expect(r).rejects.toBeInstanceOf(ErrorTiempoAgotado);
    await vi.advanceTimersByTimeAsync(5001);
    await esperado;
  });
  it('limpia el temporizador cuando termina a tiempo', async () => {
    vi.useFakeTimers();
    await conTiempoMaximo(Promise.resolve(1), 5000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
