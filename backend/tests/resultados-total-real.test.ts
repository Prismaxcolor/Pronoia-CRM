import { describe, it, expect } from 'vitest';
import type { PackingListDetalle, ProyeccionLotePacking } from '../../shared/types/index.js';
import { calcularResultadoTotal, parsearTotalUsd, textoTotalUsd } from '../../frontend/src/lib/resultados-exportacion';
import { estadoExportacion, totalesExportacion } from '../../frontend/src/lib/exportaciones';
import { entradaDeExportacion } from '../../frontend/src/features/exportaciones/asistente';
import { construirEntrada, cabeceraDesde, valoracionDesde, valoracionVacia } from '../../frontend/src/features/packing-list/formulario';

const kgs = [{ lote: '1', kg: 100 }, { lote: '2', kg: 50 }];
const pry = (...l: ProyeccionLotePacking[]) => l;

describe('parsearTotalUsd / textoTotalUsd', () => {
  it('lee montos con coma o punto decimal y miles', () => {
    expect(parsearTotalUsd('13193,46')).toBe(13193.46);
    expect(parsearTotalUsd('13.193,46')).toBe(13193.46);
    expect(parsearTotalUsd('13193.46')).toBe(13193.46);
    expect(parsearTotalUsd(' 500 ')).toBe(500);
    expect(parsearTotalUsd('0')).toBe(0);
  });
  it('vacío o inválido es null (más de 2 decimales, negativo, texto, enorme)', () => {
    for (const t of ['', '  ', 'abc', '-5', '1,234', '1.2.3', '1e5', '999999999999']) {
      expect(parsearTotalUsd(t)).toBeNull();
    }
  });
  it('textoTotalUsd usa coma decimal y vacío para null', () => {
    expect(textoTotalUsd(13193.46)).toBe('13193,46');
    expect(textoTotalUsd(500)).toBe('500');
    expect(textoTotalUsd(null)).toBe('');
    expect(textoTotalUsd(undefined)).toBe('');
  });
});

describe('calcularResultadoTotal (proyección total vs total real cobrado)', () => {
  it('compara la suma de lotes estimados con el total real: diferencia en USD y %', () => {
    const r = calcularResultadoTotal(kgs, { '1': 2, '2': 4 }, 450);
    expect(r).toEqual({ estimadoUsd: 400, realUsd: 450, diferenciaUsd: 50, diferenciaPct: 12.5, lotesSinEstimar: 0 });
  });
  it('diferencia negativa cuando se cobró menos', () => {
    const r = calcularResultadoTotal(kgs, { '1': 2, '2': 4 }, 300);
    expect(r).toMatchObject({ diferenciaUsd: -100, diferenciaPct: -25 });
  });
  it('sin total real: no hay diferencia, la proyección sigue visible', () => {
    const r = calcularResultadoTotal(kgs, { '1': 2, '2': 4 }, null);
    expect(r).toEqual({ estimadoUsd: 400, realUsd: null, diferenciaUsd: null, diferenciaPct: null, lotesSinEstimar: 0 });
  });
  it('sin ningún lote estimado: proyección null y sin diferencia (no inventa)', () => {
    const r = calcularResultadoTotal(kgs, {}, 450);
    expect(r).toEqual({ estimadoUsd: null, realUsd: 450, diferenciaUsd: null, diferenciaPct: null, lotesSinEstimar: 2 });
  });
  it('cuenta los lotes sin estimar y suma solo los estimados', () => {
    const r = calcularResultadoTotal(kgs, { '1': 2 }, 250);
    expect(r).toMatchObject({ estimadoUsd: 200, diferenciaUsd: 50, lotesSinEstimar: 1 });
  });
  it('proyección en cero: porcentaje null (sin división por cero)', () => {
    const r = calcularResultadoTotal(kgs, { '1': 0 }, 10);
    expect(r).toMatchObject({ estimadoUsd: 0, diferenciaUsd: 10, diferenciaPct: null });
  });
  it('un total real de 0 es un dato válido (no se trata como ausente)', () => {
    expect(calcularResultadoTotal(kgs, { '1': 2 }, 0)).toMatchObject({ realUsd: 0, diferenciaUsd: -200, diferenciaPct: -100 });
  });
});

describe('estado y totales de la lista de exportaciones con total real', () => {
  it('un total real cobrado hace que la exportación esté "con resultado"', () => {
    expect(estadoExportacion(kgs, pry({ lote: '1', valorKgUsd: 2 }), 100)).toBe('con_resultado');
    expect(estadoExportacion(kgs, [], 0)).toBe('con_resultado');
  });
  it('sin total real el estado no cambia; sin proyección visible sigue sin estado', () => {
    expect(estadoExportacion(kgs, pry({ lote: '1', valorKgUsd: 2 }), null)).toBe('borrador');
    expect(estadoExportacion(kgs, pry({ lote: '1', valorKgUsd: 2 }))).toBe('borrador');
    expect(estadoExportacion(kgs, undefined, 100)).toBeNull();
  });
  it('con total real, "total real" y "diferencia" salen del total cobrado', () => {
    const t = totalesExportacion(kgs, pry(
      { lote: '1', valorKgUsd: 2, valorRealKgUsd: 99 }, { lote: '2', valorKgUsd: 4 },
    ), 450);
    expect(t).toEqual({ estimadoUsd: 400, realUsd: 450, diferenciaUsd: 50, parcial: false });
  });
  it('con total real y lotes sin estimar, la diferencia se marca como parcial', () => {
    const t = totalesExportacion(kgs, pry({ lote: '1', valorKgUsd: 2 }), 250);
    expect(t).toEqual({ estimadoUsd: 200, realUsd: 250, diferenciaUsd: 50, parcial: true });
  });
  it('con total real y sin ningún estimado, la diferencia es null', () => {
    expect(totalesExportacion(kgs, [], 250)).toEqual({ estimadoUsd: null, realUsd: 250, diferenciaUsd: null, parcial: false });
  });
  it('sin total real mantiene el comportamiento por lote', () => {
    const t = totalesExportacion(kgs, pry({ lote: '1', valorKgUsd: 2, valorRealKgUsd: 3 }, { lote: '2', valorKgUsd: 4 }), null);
    expect(t).toMatchObject({ realUsd: 300, diferenciaUsd: 100, parcial: true });
  });
  it('sin proyección visible todo es null aunque haya total', () => {
    expect(totalesExportacion(kgs, undefined, 100)).toEqual({ estimadoUsd: null, realUsd: null, diferenciaUsd: null, parcial: false });
  });
});

const detalle = (extra: Partial<PackingListDetalle> = {}): PackingListDetalle => ({
  id: 'p1', contenedor: 'SEKU-1', fecha: '2026-01-01', tipoEmbalaje: 'big_bag', esPcb: true,
  descripcionEs: null, descripcionEn: null, observacionesEs: null, observacionesEn: null,
  referenciaTipo: null, referenciaId: null, clienteId: null, createdAt: '', updatedAt: '', version: 7,
  items: [{ numero: 1, numeroPaleta: 1, lote: '1', color: null, pesoBruto: 100, pesoPaleta: 5, pesoNeto: 95 }],
  ...extra,
});

describe('formulario: total real', () => {
  it('valoracionDesde carga el total como texto (vacío si no hay)', () => {
    expect(valoracionDesde(detalle({ proyeccion: [], totalRealUsd: 13193.46 })).totalReal).toBe('13193,46');
    expect(valoracionDesde(detalle({ proyeccion: [] })).totalReal).toBe('');
    expect(valoracionDesde(detalle({ proyeccion: [], totalRealUsd: null })).totalReal).toBe('');
    expect(valoracionVacia().totalReal).toBe('');
  });
  it('construirEntrada envía totalRealUsd numérico o null cuando hay valoración', () => {
    const d = detalle();
    const ref = { referenciaTipo: null, referenciaId: null, version: 7 } as const;
    const con = construirEntrada(cabeceraDesde(d), [], ref, { ...valoracionVacia(), totalReal: '500,5' });
    const sin = construirEntrada(cabeceraDesde(d), [], ref, valoracionVacia());
    if ('error' in con || 'error' in sin) throw new Error('no debería fallar');
    expect(con.entrada.totalRealUsd).toBe(500.5);
    expect(sin.entrada.totalRealUsd).toBeNull();
  });
  it('sin valoración (sin permiso) no envía la clave: el servidor conserva el total', () => {
    const r = construirEntrada(cabeceraDesde(detalle()), [], { referenciaTipo: null, referenciaId: null, version: 7 });
    if ('error' in r) throw new Error(r.error);
    expect('totalRealUsd' in r.entrada).toBe(false);
  });
  it('un total inválido devuelve un error legible', () => {
    const r = construirEntrada(cabeceraDesde(detalle()), [], { referenciaTipo: null, referenciaId: null, version: 7 }, { ...valoracionVacia(), totalReal: '12,345' });
    expect('error' in r && r.error).toMatch(/Total real cobrado.*no es válido/);
  });
  it('entradaDeExportacion (asistente) lo incluye solo con facturacion:ver', () => {
    const valoracion = { ...valoracionVacia(), totalReal: '450' };
    const opc = { clienteId: 'c', valoracion, puedeVerControl: true };
    const con = entradaDeExportacion(detalle(), { ...opc, puedeVerValores: true });
    const sin = entradaDeExportacion(detalle(), { ...opc, puedeVerValores: false });
    if ('error' in con || 'error' in sin) throw new Error('no debería fallar');
    expect(con.entrada.totalRealUsd).toBe(450);
    expect('totalRealUsd' in sin.entrada).toBe(false);
  });
});
