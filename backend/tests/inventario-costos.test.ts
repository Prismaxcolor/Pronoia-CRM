import { describe, it, expect } from 'vitest';
import {
  COSTO_MAXIMO_USD_KG,
  agruparPorCategoria,
  aplicarCostoACategoria,
  calcularTotales,
  editarCosto,
  estadoFila,
  filtrarFilas,
  itemsParaGuardar,
  parsearCosto,
  quitarCostoManual,
  textoDeCosto,
  type FilaCosto,
} from '../../frontend/src/lib/inventario-costos';

function fila(p: Partial<FilaCosto> & { productoId: string }): FilaCosto {
  return {
    nombre: p.productoId, categoria: 'PCB', categoriaClave: 'pcb', kg: 100,
    costoFacturasKg: null, costoReferenciaKg: null, costoEfectivoKg: null, fuente: null, valorUsd: null,
    ...p,
  };
}

const SIN = fila({ productoId: 'a', kg: 100 });
const FACT = fila({ productoId: 'b', kg: 50, costoFacturasKg: 2, costoEfectivoKg: 2, fuente: 'facturas', valorUsd: 100 });
const MAN = fila({ productoId: 'c', kg: 10, costoFacturasKg: 2, costoReferenciaKg: 5, costoEfectivoKg: 5, fuente: 'manual', valorUsd: 50 });
const FILAS = [SIN, FACT, MAN];

describe('parsearCosto', () => {
  it('acepta coma y punto decimal', () => {
    expect(parsearCosto('12,5')).toEqual({ ok: true, valor: 12.5 });
    expect(parsearCosto('12.5')).toEqual({ ok: true, valor: 12.5 });
    expect(parsearCosto('1.234,5')).toEqual({ ok: true, valor: 1234.5 });
  });
  it('vacío significa sin costo manual', () => {
    expect(parsearCosto('  ')).toEqual({ ok: true, valor: null });
  });
  it('rechaza negativos, texto y valores excesivos', () => {
    expect(parsearCosto('-1').ok).toBe(false);
    expect(parsearCosto('abc').ok).toBe(false);
    expect(parsearCosto('1,2,3').ok).toBe(false);
    expect(parsearCosto('1.2.3').ok).toBe(false);
    expect(parsearCosto(String(COSTO_MAXIMO_USD_KG + 1)).ok).toBe(false);
  });
  it('acepta cero y redondea a 4 decimales', () => {
    expect(parsearCosto('0')).toEqual({ ok: true, valor: 0 });
    expect(parsearCosto('1,123456')).toEqual({ ok: true, valor: 1.1235 });
  });
});

describe('estadoFila y totales', () => {
  it('sin ediciones refleja lo guardado', () => {
    expect(estadoFila(MAN, {}).fuente).toBe('manual');
    expect(estadoFila(FACT, {}).valorUsd).toBe(100);
    expect(estadoFila(SIN, {}).valorUsd).toBeNull();
  });
  it('una edición manda sobre facturas y recalcula el valor', () => {
    const e = editarCosto({}, FACT, '3,5');
    const s = estadoFila(FACT, e);
    expect(s.fuente).toBe('manual');
    expect(s.valorUsd).toBe(175);
    expect(s.modificado).toBe(true);
  });
  it('volver al valor guardado quita el cambio', () => {
    const e = editarCosto(editarCosto({}, MAN, '7'), MAN, '5');
    expect(e).toEqual({});
  });
  it('quitar costo manual vuelve al promedio de facturas', () => {
    const e = quitarCostoManual({}, MAN);
    const s = estadoFila(MAN, e);
    expect(s.fuente).toBe('facturas');
    expect(s.costoEfectivoKg).toBe(2);
    expect(itemsParaGuardar(FILAS, e)).toEqual([{ productoId: 'c', costoReferenciaKg: null }]);
  });
  it('totales en vivo', () => {
    expect(calcularTotales(FILAS, {})).toMatchObject({ valorUsd: 150, kgSinCosto: 100, productosSinCosto: 1, cambios: 0 });
    const e = editarCosto({}, SIN, '1');
    expect(calcularTotales(FILAS, e)).toMatchObject({ valorUsd: 250, kgSinCosto: 0, productosSinCosto: 0, cambios: 1 });
  });
  it('valorUsd total es null si nadie tiene costo', () => {
    expect(calcularTotales([SIN], {}).valorUsd).toBeNull();
  });
  it('un texto inválido cuenta como inválido y no se envía', () => {
    const e = editarCosto({}, SIN, 'x');
    expect(calcularTotales(FILAS, e).invalidos).toBe(1);
    expect(itemsParaGuardar(FILAS, e)).toEqual([]);
  });
  it('no muta las ediciones recibidas', () => {
    const base = Object.freeze({ a: '1' });
    expect(() => editarCosto(base, SIN, '2')).not.toThrow();
    expect(base).toEqual({ a: '1' });
  });
});

describe('itemsParaGuardar', () => {
  it('envía solo filas modificadas', () => {
    const e = editarCosto(editarCosto({}, SIN, '4'), FACT, '2');
    expect(itemsParaGuardar(FILAS, e)).toEqual([{ productoId: 'a', costoReferenciaKg: 4 }, { productoId: 'b', costoReferenciaKg: 2 }]);
  });
});

describe('aplicar costo por categoría', () => {
  const OTRA = fila({ productoId: 'd', categoria: 'PGM', categoriaClave: 'pgm' });
  const todas = [...FILAS, OTRA];
  it('por defecto solo a los sin costo de esa categoría', () => {
    const e = aplicarCostoACategoria(todas, {}, 'pcb', '3', true);
    expect(Object.keys(e)).toEqual(['a']);
  });
  it('con soloSinCosto=false pisa también los que ya tienen costo', () => {
    const e = aplicarCostoACategoria(todas, {}, 'pcb', '3', false);
    expect(Object.keys(e).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('agrupar y filtrar', () => {
  it('agrupa por categoría y ordena por nombre', () => {
    const g = agruparPorCategoria([fila({ productoId: 'z', nombre: 'Zeta' }), fila({ productoId: 'y', nombre: 'Alfa' }), fila({ productoId: 'p', categoria: 'PGM', categoriaClave: 'pgm' })]);
    expect(g.map(x => x.categoria)).toEqual(['PCB', 'PGM']);
    expect(g[0].filas.map(f => f.nombre)).toEqual(['Alfa', 'Zeta']);
  });
  it('filtra por texto sin tildes, sin costo y con cambios', () => {
    const f2 = fila({ productoId: 'e', nombre: 'Tarjeta Madre' });
    const todas = [...FILAS, f2];
    expect(filtrarFilas(todas, {}, { busqueda: 'tarjeta', soloSinCosto: false, soloConCambios: false })).toEqual([f2]);
    expect(filtrarFilas(todas, {}, { busqueda: '', soloSinCosto: true, soloConCambios: false }).map(f => f.productoId)).toEqual(['a', 'e']);
    const e = editarCosto({}, MAN, '9');
    expect(filtrarFilas(todas, e, { busqueda: '', soloSinCosto: false, soloConCambios: true })).toEqual([MAN]);
  });
});

describe('textoDeCosto', () => {
  it('usa coma y omite ceros sobrantes', () => {
    expect(textoDeCosto(12.5)).toBe('12,5');
    expect(textoDeCosto(3)).toBe('3');
    expect(textoDeCosto(null)).toBe('');
  });
});
