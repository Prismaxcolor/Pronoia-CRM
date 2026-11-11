import { describe, it, expect } from 'vitest';
import {
  agruparPorCategoria, conVariacion, diasEnRango, granularidadPara, prepararFlujo, serieFlujo, tablaEfectivo, topGastos, totalesFlujo,
} from '../../frontend/src/features/wallet/estadisticas/estadisticas-logica';
import { resumenActivos, saldoPorMoneda, saldosNegativos, saldosPorCuenta } from '../../frontend/src/features/wallet/estadisticas/estadisticas-saldos';
import { tabDesdeTexto, usaMovimientos } from '../../frontend/src/features/wallet/estadisticas/estadisticas-tabs';
import type { Banca, CategoriaWallet, Movimiento } from '../../shared/types/index.js';

let n = 0;
const mov = (extra: Partial<Movimiento>): Movimiento => ({
  id: `m${++n}`, tipo: 'egreso', monto: 10, moneda: 'USD', descripcion: '', bancaOrigenId: 'b1', bancaDestinoId: null,
  fecha: '2026-11-05', referencia: '', registradoPor: 'u', proveedorId: null, clienteId: null, montoUsd: null, montoDestino: null,
  creadoEn: '', subtipo: null, numero: null, numeroSistema: null, grupoId: null, comprobantes: [], anulado: false,
  anuladoMotivo: null, anuladoEn: null, anuladoPor: null, categoriaId: null, ...extra,
});
const cat = (id: string, nombre: string, padreId: string | null = null, color = '#112233'): CategoriaWallet => ({
  id, nombre, tipo: 'AMBOS', color, padreId, activo: true, imagenUrl: null, creadoEn: '',
});
const banca = (id: string, extra: Partial<Banca> = {}): Banca => ({
  id, nombre: id, tipo: 'efectivo', saldo: 0, moneda: 'USD', descripcion: '', archivada: false, ...extra,
});
const rango = { desde: '2026-11-01', hasta: '2026-11-10' };

describe('prepararFlujo', () => {
  it('excluye anulados, transferencias y fechas fuera del rango', () => {
    const p = prepararFlujo([
      mov({ tipo: 'ingreso', monto: 100 }),
      mov({ tipo: 'egreso', monto: 40 }),
      mov({ tipo: 'egreso', monto: 999, anulado: true }),
      mov({ tipo: 'transferencia', monto: 500, bancaDestinoId: 'b2' }),
      mov({ tipo: 'egreso', monto: 7, fecha: '2026-10-31' }),
    ], rango);
    expect(p.ingresos.map(i => i.usd)).toEqual([100]);
    expect(p.egresos.map(i => i.usd)).toEqual([40]);
    expect(p.sinEquivalente).toBe(0);
  });

  it('cuenta aparte, sin sumar, los movimientos sin equivalente en USD', () => {
    const p = prepararFlujo([
      mov({ tipo: 'egreso', monto: 5000, moneda: 'VES' }),
      mov({ tipo: 'egreso', monto: 5000, moneda: 'VES', montoUsd: 50 }),
      mov({ tipo: 'ingreso', monto: 100, moneda: 'VES', equivalenteUsd: 2 }),
    ], rango);
    expect(p.egresos.map(e => e.usd)).toEqual([50]);
    expect(p.ingresos.map(e => e.usd)).toEqual([2]);
    expect(p.sinEquivalente).toBe(1);
    expect(p.sinEquivalenteEgresos).toBe(1);
  });

  it('separa los egresos excluidos de los ingresos excluidos', () => {
    const p = prepararFlujo([
      mov({ tipo: 'ingreso', monto: 100, moneda: 'VES' }),
      mov({ tipo: 'ingreso', monto: 100, moneda: 'VES' }),
      mov({ tipo: 'egreso', monto: 100, moneda: 'VES' }),
    ], rango);
    expect(p.sinEquivalente).toBe(3);
    expect(p.sinEquivalenteEgresos).toBe(1);
  });

  it('cuenta como gasto el egreso de comisión asociado a una transferencia (la transferencia no)', () => {
    const p = prepararFlujo([
      mov({ tipo: 'transferencia', monto: 1000, bancaDestinoId: 'b2' }),
      mov({ tipo: 'egreso', monto: 3, comisionDeId: 'x' }),
    ], rango);
    expect(p.egresos).toHaveLength(1);
    expect(p.egresos[0].usd).toBe(3);
  });
});

describe('totales y variación', () => {
  it('calcula flujo neto y cantidades', () => {
    const p = prepararFlujo([mov({ tipo: 'ingreso', monto: 100 }), mov({ tipo: 'egreso', monto: 30 }), mov({ tipo: 'egreso', monto: 20 })], rango);
    expect(totalesFlujo(p)).toEqual({ ingresos: 100, egresos: 50, neto: 50, cantidadIngresos: 1, cantidadEgresos: 2 });
  });
});

describe('serieFlujo', () => {
  it('rellena los días vacíos y acumula el neto', () => {
    const p = prepararFlujo([
      mov({ tipo: 'ingreso', monto: 100, fecha: '2026-11-02' }),
      mov({ tipo: 'egreso', monto: 30, fecha: '2026-11-03' }),
      mov({ tipo: 'egreso', monto: 0.1, fecha: '2026-11-03' }),
      mov({ tipo: 'egreso', monto: 0.2, fecha: '2026-11-03' }),
    ], rango);
    const s = serieFlujo(rango, p, 'dia');
    expect(s).toHaveLength(10);
    expect(s[1]).toMatchObject({ clave: '2026-11-02', ingresos: 100, egresos: 0, neto: 100, acumulado: 100 });
    expect(s[2]).toMatchObject({ egresos: 30.3, neto: -30.3, acumulado: 69.7 });
    expect(s[9].acumulado).toBe(69.7);
  });

  it('agrupa por semana (lunes) y por mes', () => {
    const r = { desde: '2026-09-15', hasta: '2026-11-10' };
    const p = prepararFlujo([
      mov({ tipo: 'ingreso', monto: 10, fecha: '2026-09-16' }),
      mov({ tipo: 'ingreso', monto: 5, fecha: '2026-09-20' }),
      mov({ tipo: 'egreso', monto: 4, fecha: '2026-11-09' }),
    ], r);
    const sem = serieFlujo(r, p, 'semana');
    expect(sem[0]).toMatchObject({ clave: '2026-09-14', ingresos: 15 });
    expect(sem[sem.length - 1]).toMatchObject({ clave: '2026-11-09', egresos: 4 });
    const mes = serieFlujo(r, p, 'mes');
    expect(mes.map(x => x.clave)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(mes[0].ingresos).toBe(15);
    expect(mes[2].acumulado).toBe(11);
  });

  it('elige la granularidad según la duración', () => {
    expect(diasEnRango(rango)).toBe(10);
    expect(granularidadPara({ desde: '2026-10-13', hasta: '2026-11-11' })).toBe('dia');
    expect(granularidadPara({ desde: '2026-08-20', hasta: '2026-11-11' })).toBe('semana');
    expect(granularidadPara({ desde: '2026-05-12', hasta: '2026-11-11' })).toBe('mes');
  });
});

describe('categorías', () => {
  const cats = [cat('c1', 'Servicios', null, '#AAAAAA'), cat('c1a', 'Luz', 'c1'), cat('c2', 'Comida')];
  const indice = new Map(cats.map(c => [c.id, c]));

  it('agrupa por categoría raíz con sus subcategorías y "Sin categoría"', () => {
    const p = prepararFlujo([
      mov({ monto: 30, categoriaId: 'c1a' }), mov({ monto: 20, categoriaId: 'c1' }), mov({ monto: 15, categoriaId: 'c2' }),
      mov({ monto: 5 }), mov({ monto: 1, categoriaId: 'zzz' }),
    ], rango);
    const filas = agruparPorCategoria(p.egresos, indice);
    expect(filas.map(f => [f.nombre, f.usd, f.cantidad])).toEqual([['Servicios', 50, 2], ['Comida', 15, 1], ['Sin categoría', 5, 1], ['Otra categoría', 1, 1]]);
    expect(filas[0].color).toBe('#AAAAAA');
    expect(filas[0].hijas.map(h => [h.nombre, h.usd])).toEqual([['Luz', 30], ['Servicios (sin subcategoría)', 20]]);
  });

  it('calcula variación contra el período anterior y deja null si no hay base', () => {
    const act = agruparPorCategoria(prepararFlujo([mov({ monto: 30, categoriaId: 'c2' }), mov({ monto: 10, categoriaId: 'c1' })], rango).egresos, indice);
    const ant = agruparPorCategoria(prepararFlujo([mov({ monto: 20, categoriaId: 'c2' })], rango).egresos, indice);
    const v = conVariacion(act, ant);
    expect(v.find(f => f.id === 'c2')?.variacion).toBe(50);
    expect(v.find(f => f.id === 'c1')?.variacion).toBeNull();
    expect(conVariacion(act, null).every(f => f.variacion === null)).toBe(true);
  });
});

describe('top de gastos y tabla de efectivo', () => {
  it('ordena los gastos de mayor a menor y limita', () => {
    const p = prepararFlujo([mov({ monto: 5 }), mov({ monto: 50, bancaOrigenId: 'b9' }), mov({ monto: 20 })], rango);
    const top = topGastos(p.egresos, 2);
    expect(top.map(t => t.usd)).toEqual([50, 20]);
    expect(top[0].bancaId).toBe('b9');
  });

  it('calcula cantidad, promedio por día y por registro; sin registros no inventa promedios', () => {
    const p = prepararFlujo([mov({ monto: 30 }), mov({ monto: 20 })], rango);
    expect(tablaEfectivo(p.egresos, 10)).toEqual({ cantidad: 2, promedioPorDia: 5, promedioPorRegistro: 25, total: 50 });
    expect(tablaEfectivo([], 10)).toEqual({ cantidad: 0, promedioPorDia: null, promedioPorRegistro: null, total: 0 });
  });
});

describe('saldos', () => {
  const tasa = 100;
  const bancas = [
    banca('caja', { saldo: 50 }),
    banca('bs', { saldo: 10000, moneda: 'VES', tipo: 'banco_nacional' }),
    banca('deuda', { saldo: -20 }),
    banca('inv', { saldo: 200, grupoWallet: 'inversiones' }),
    banca('vieja', { saldo: 999, archivada: true }),
  ];

  it('ordena de mayor a menor en USD, convierte Bs y omite archivadas', () => {
    const f = saldosPorCuenta(bancas, tasa);
    expect(f.map(x => [x.id, x.usd])).toEqual([['inv', 200], ['bs', 100], ['caja', 50], ['deuda', -20]]);
    expect(f[0].color).toBe('#039BE5');
    expect(saldosNegativos(f).map(x => x.id)).toEqual(['deuda']);
  });

  it('sin tasa deja el Bs sin convertir al final y no lo suma', () => {
    const f = saldosPorCuenta(bancas, null);
    expect(f[f.length - 1]).toMatchObject({ id: 'bs', usd: null });
  });

  it('separa por moneda sin convertir y da proporciones solo si hay tasa', () => {
    const con = saldoPorMoneda(bancas, tasa);
    expect(con.partes.map(p => [p.moneda, p.saldo, p.cuentas])).toEqual([['USD', 230, 3], ['VES', 10000, 1]]);
    expect(con.totalUsd).toBe(330);
    // Peso sobre saldos positivos: 100 / (250 + 100) = 28,57 % (la deuda de 20 no reparte).
    expect(con.partes[1].pct).toBeCloseTo(28.57, 1);
    const sin = saldoPorMoneda(bancas, null);
    expect(sin.partes.every(p => p.pct === null)).toBe(true);
    expect(sin.omitidas).toBe(1);
  });

  it('activos: porcentaje en inversiones sobre saldos positivos, por grupo', () => {
    const r = resumenActivos(bancas, tasa);
    expect(r.totalUsd).toBe(350);
    expect(r.inversionesUsd).toBe(200);
    expect(r.pctInversiones).toBeCloseTo(57.14, 1);
    expect(r.grupos.map(g => g.grupo.clave)).toEqual(['efectivo', 'corriente', 'inversiones']);
    expect(r.grupos[0].cuentas.map(c => c.id)).toEqual(['caja']);
    expect(r.negativas).toBe(1);
  });

  it('activos sin saldo positivo no inventa porcentaje', () => {
    expect(resumenActivos([banca('a', { saldo: 0 })], tasa).pctInversiones).toBeNull();
  });
});

describe('pestañas de la URL', () => {
  it('acepta una pestaña válida (sin importar mayúsculas) y cae en Saldo con cualquier otra cosa', () => {
    expect(tabDesdeTexto('gastos')).toBe('gastos');
    expect(tabDesdeTexto('FLUJO')).toBe('flujo');
    expect(tabDesdeTexto('perspectiva')).toBe('saldo');
    expect(tabDesdeTexto(null)).toBe('saldo');
  });

  it('solo flujo, gastos e informes leen el historial de movimientos', () => {
    expect(['saldo', 'flujo', 'gastos', 'informes', 'activos'].map(t => usaMovimientos(t as never))).toEqual([false, true, true, true, false]);
  });
});
