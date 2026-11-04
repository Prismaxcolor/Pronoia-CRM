import { describe, it, expect } from 'vitest';
import {
  esFechaIso, formatearCompacto, formatearDelta, formatearFecha, formatearFechaCorta, formatearKg, formatearKgDecimales,
  formatearNumero, formatearPct, formatearUsd, formatearUsdDecimales,
} from '../../frontend/src/lib/formato';
import * as inventarioNuevo from '../../frontend/src/lib/inventario-nuevo';
import { hoyLocal, rangoDeAtajo } from '../../frontend/src/lib/rango-fechas';
import { compararConPeriodoAnterior } from '../../frontend/src/lib/comparacion';
import { ESTADOS, ESTILOS_TONO, SEVERIDADES, colorDeSerie, infoEstado, infoTipoOperacion, PALETA_SERIES } from '../../frontend/src/lib/paleta';
import { ESTILO_SEVERIDAD } from '../../frontend/src/lib/inventario-pantalla';
import {
  BOM_UTF8, campoCsv, construirCsv, escaparCampoCsv, nombreArchivoCsv, numeroCsv,
} from '../../frontend/src/lib/csv';
import {
  SIN_ORDEN, agruparFilas, alternarOrden, ariaSort, columnasParaCsv, compararValores, ordenarFilas, ordenarGrupos, paginar, sumar,
  valorATexto, type ColumnaTabla,
} from '../../frontend/src/lib/tabla-datos';
import { contarFiltrosActivos, escribirFiltros, leerFiltros, limpiarFiltros, type EsquemaFiltros } from '../../frontend/src/lib/filtros-url';
import {
  angulosDona, apilarCategoria, calcularEjeY, escalaLineal, geometriaBarras, indiceMasCercano, numeroBonito, porcentajesDeMaximo,
  porcionesDona, posicionesX, resumirSerie, rutaArco, rutaArea, rutaLinea, variacionPct,
} from '../../frontend/src/lib/graficas';

describe('formato es-VE unificado', () => {
  it('mantiene los formatos históricos (y se re-exportan desde inventario-nuevo)', () => {
    expect(formatearNumero(1234567.891, 2)).toBe('1.234.567,89');
    expect(formatearKg(1234)).toBe('1.234,00 kg');
    expect(formatearKg(11.735)).toBe('11,735 kg');
    expect(formatearKg(12.5)).toBe('12,50 kg');
    expect(formatearUsd(5000)).toBe('USD 5.000');
    expect(formatearPct(12.345)).toBe('12,3 %');
    expect(inventarioNuevo.formatearKg).toBe(formatearKg);
    expect(inventarioNuevo.formatearNumero).toBe(formatearNumero);
    expect(inventarioNuevo.esFechaIso).toBe(esFechaIso);
    expect(inventarioNuevo.rangoDeAtajo).toBe(rangoDeAtajo);
    expect(inventarioNuevo.compararConPeriodoAnterior).toBe(compararConPeriodoAnterior);
  });

  it('formatea con decimales y unidad', () => {
    expect(formatearKgDecimales(1234.5, 1)).toBe('1.234,5 kg');
    expect(formatearUsdDecimales(1234.5)).toBe('USD 1.234,50');
    expect(formatearNumero(Number.NaN)).toBe('—');
  });

  it('formatearDelta pone signo explícito solo cuando hay cambio', () => {
    expect(formatearDelta(1.5)).toBe('+1,5');
    expect(formatearDelta(-2)).toBe('-2,0');
    expect(formatearDelta(0)).toBe('0,0');
    expect(formatearDelta(0.01)).toBe('0,0');
    expect(formatearDelta(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('formatearCompacto abrevia miles y millones', () => {
    expect(formatearCompacto(950)).toBe('950');
    expect(formatearCompacto(1200)).toBe('1,2 mil');
    expect(formatearCompacto(25000)).toBe('25 mil');
    expect(formatearCompacto(3400000)).toBe('3,4 M');
    expect(formatearCompacto(0)).toBe('0');
    expect(formatearCompacto(2.5)).toBe('2,5');
  });

  it('formatea fechas ISO sin corrimiento de zona horaria', () => {
    expect(formatearFecha('2026-10-04')).toBe('04/10/2026');
    expect(formatearFecha('2026-10-04T23:59:59Z')).toBe('04/10/2026');
    expect(formatearFecha(new Date(2026, 9, 4, 12))).toBe('04/10/2026');
    expect(formatearFechaCorta('2026-10-04')).toBe('04/10');
    expect(formatearFecha(null)).toBe('—');
    expect(formatearFecha('2026-02-31')).toBe('—');
    expect(formatearFecha(new Date('x'))).toBe('—');
  });

  it('esFechaIso valida el calendario real', () => {
    expect(esFechaIso('2026-02-28')).toBe(true);
    expect(esFechaIso('2026-02-30')).toBe(false);
    expect(esFechaIso('26-02-28')).toBe(false);
  });

  it('hoyLocal toma el día de Caracas como UTC a medianoche (no el día UTC ni el del navegador)', () => {
    expect(hoyLocal(new Date('2026-10-05T03:30:00Z')).toISOString()).toBe('2026-10-04T00:00:00.000Z');
    expect(hoyLocal(new Date('2026-10-05T04:00:00Z')).toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });
});

describe('paleta semántica', () => {
  it('cada estado tiene etiqueta en texto y tono; anulada no es roja', () => {
    expect(Object.keys(ESTADOS)).toEqual(expect.arrayContaining(['pagada', 'pendiente', 'anulada', 'borrador', 'emitida', 'bruto', 'completo']));
    expect(infoEstado('Pagada')).toEqual({ etiqueta: 'Pagada', tono: 'exito' });
    expect(infoEstado('ANULADA').tono).toBe('neutral');
    expect(infoEstado('pendiente').tono).toBe('aviso');
  });

  it('un estado desconocido sale neutro con su propio texto; sin estado, "—"', () => {
    expect(infoEstado('en revisión')).toEqual({ etiqueta: 'en revisión', tono: 'neutral' });
    expect(infoEstado(null)).toEqual({ etiqueta: '—', tono: 'neutral' });
    expect(infoTipoOperacion('Compra').tono).toBe('marca');
    expect(infoTipoOperacion('venta').etiqueta).toBe('Venta');
  });

  it('solo la severidad roja usa rojo', () => {
    expect(SEVERIDADES.roja.contenedor).toContain('red');
    expect(SEVERIDADES.amarilla.contenedor).not.toContain('red');
    expect(SEVERIDADES.info.contenedor).not.toContain('red');
    expect(ESTILOS_TONO.peligro.insignia).toContain('red');
    for (const t of ['neutral', 'marca', 'exito', 'aviso', 'info'] as const) expect(ESTILOS_TONO[t].insignia).not.toContain('red');
  });

  it('las severidades coinciden con las de la pantalla de inventario aprobada', () => {
    for (const s of ['roja', 'amarilla', 'info'] as const) {
      expect(SEVERIDADES[s].etiqueta).toBe(ESTILO_SEVERIDAD[s].etiqueta);
      expect(SEVERIDADES[s].contenedor).toBe(ESTILO_SEVERIDAD[s].contenedor);
      expect(SEVERIDADES[s].insignia).toBe(ESTILO_SEVERIDAD[s].insignia);
    }
  });

  it('la paleta de series es cíclica, sin rojo, y la primera es la marca', () => {
    expect(PALETA_SERIES[0]).toContain('--color-brand');
    expect(colorDeSerie(PALETA_SERIES.length)).toBe(PALETA_SERIES[0]);
    expect(colorDeSerie(-1)).toBe(PALETA_SERIES[PALETA_SERIES.length - 1]);
  });
});

describe('CSV', () => {
  it('escapa comillas, separadores y saltos de línea', () => {
    expect(escaparCampoCsv('hola')).toBe('hola');
    expect(escaparCampoCsv('a;b')).toBe('"a;b"');
    expect(escaparCampoCsv('di "hola"')).toBe('"di ""hola"""');
    expect(escaparCampoCsv('l1\nl2')).toBe('"l1\nl2"');
  });

  it('neutraliza fórmulas en texto (= + - @ y tab/CR)', () => {
    expect(escaparCampoCsv('=SUMA(A1:A2)')).toBe("'=SUMA(A1:A2)");
    expect(escaparCampoCsv('+58 412')).toBe("'+58 412");
    expect(escaparCampoCsv('@cmd')).toBe("'@cmd");
    expect(escaparCampoCsv('-1+1')).toBe("'-1+1");
    expect(escaparCampoCsv('=HYPERLINK("x";"y")')).toBe(`"'=HYPERLINK(""x"";""y"")"`);
  });

  it('un número negativo NO se trata como fórmula y usa coma decimal', () => {
    expect(campoCsv(-12.5)).toBe('-12,5');
    expect(numeroCsv(1234.567, 2)).toBe('1234,57');
    expect(numeroCsv(null)).toBe('');
    expect(numeroCsv(Number.NaN)).toBe('');
  });

  it('convierte booleanos, fechas y vacíos', () => {
    expect(campoCsv(true)).toBe('Sí');
    expect(campoCsv(false)).toBe('No');
    expect(campoCsv(new Date('2026-10-04T10:00:00Z'))).toBe('2026-10-04');
    expect(campoCsv(new Date('x'))).toBe('');
    expect(campoCsv(undefined)).toBe('');
  });

  it('construye el CSV con BOM, ; y CRLF, encabezado escapado y salto final', () => {
    const filas = [{ n: 'PCB', kg: 1200.5 }, { n: '=cmd', kg: null }];
    const csv = construirCsv([{ titulo: 'Material', valor: f => f.n }, { titulo: 'Kg;neto', valor: f => f.kg, decimales: 1 }], filas);
    expect(csv.startsWith(BOM_UTF8)).toBe(true);
    expect(csv.slice(1)).toBe('Material;"Kg;neto"\r\nPCB;1200,5\r\n\'=cmd;\r\n');
  });

  it('sin filas devuelve solo el encabezado', () => {
    expect(construirCsv([{ titulo: 'A', valor: () => 1 }], [])).toBe(`${BOM_UTF8}A\r\n`);
  });

  it('el nombre de archivo se sanea y lleva la fecha', () => {
    expect(nombreArchivoCsv('Facturas de compra', new Date('2026-10-04T12:00:00Z'))).toBe('Facturas-de-compra-2026-10-04.csv');
    expect(nombreArchivoCsv('../../etc/pásswd', new Date('2026-10-04T12:00:00Z'))).toBe('etc-passwd-2026-10-04.csv');
    expect(nombreArchivoCsv('???', new Date('2026-10-04T12:00:00Z'))).toBe('datos-2026-10-04.csv');
  });
});

interface Fila { id: string; cat: string; nombre: string; kg: number | null; fecha?: Date }

const FILAS: Fila[] = [
  { id: '1', cat: 'PCB', nombre: 'Lote 10', kg: 50 },
  { id: '2', cat: 'Ferroso', nombre: 'Lote 2', kg: null },
  { id: '3', cat: 'PCB', nombre: 'Lote 1', kg: 200 },
  { id: '4', cat: 'Ferroso', nombre: 'chatarra', kg: 100 },
];

const COLUMNAS: Array<ColumnaTabla<Fila>> = [
  { clave: 'nombre', titulo: 'Nombre', valorOrden: f => f.nombre },
  { clave: 'kg', titulo: 'Kg', alinear: 'derecha', valorOrden: f => f.kg, total: filas => sumar(filas.map(f => f.kg)), decimalesCsv: 1 },
  { clave: 'accion', titulo: 'Acciones', celda: () => null, valorCsv: false },
];

describe('TablaDatos: orden', () => {
  it('alterna asc -> desc -> sin orden y reinicia al cambiar de columna', () => {
    const a = alternarOrden(SIN_ORDEN, 'kg');
    expect(a).toEqual({ columna: 'kg', sentido: 'asc' });
    const b = alternarOrden(a, 'kg');
    expect(b).toEqual({ columna: 'kg', sentido: 'desc' });
    expect(alternarOrden(b, 'kg')).toEqual(SIN_ORDEN);
    expect(alternarOrden(b, 'nombre')).toEqual({ columna: 'nombre', sentido: 'asc' });
  });

  it('aria-sort refleja el estado de cada columna', () => {
    expect(ariaSort({ columna: 'kg', sentido: 'asc' }, 'kg')).toBe('ascending');
    expect(ariaSort({ columna: 'kg', sentido: 'desc' }, 'kg')).toBe('descending');
    expect(ariaSort({ columna: 'kg', sentido: 'desc' }, 'nombre')).toBe('none');
    expect(ariaSort(SIN_ORDEN, 'kg')).toBe('none');
  });

  it('ordena números y deja los vacíos al final en ambos sentidos, sin mutar la entrada', () => {
    const copia = [...FILAS];
    const asc = ordenarFilas(FILAS, { columna: 'kg', sentido: 'asc' }, COLUMNAS).map(f => f.id);
    const desc = ordenarFilas(FILAS, { columna: 'kg', sentido: 'desc' }, COLUMNAS).map(f => f.id);
    expect(asc).toEqual(['1', '4', '3', '2']);
    expect(desc).toEqual(['3', '4', '1', '2']);
    expect(FILAS).toEqual(copia);
  });

  it('ordena texto con números naturales ("Lote 2" antes que "Lote 10") sin distinguir tildes/mayúsculas', () => {
    const r = ordenarFilas(FILAS, { columna: 'nombre', sentido: 'asc' }, COLUMNAS).map(f => f.nombre);
    expect(r).toEqual(['chatarra', 'Lote 1', 'Lote 2', 'Lote 10']);
    expect(compararValores('á', 'A')).toBe(0);
  });

  it('es estable (empates conservan el orden de origen) y sin columna/ordenable devuelve una copia', () => {
    const iguales = [{ id: 'a', kg: 1 }, { id: 'b', kg: 1 }, { id: 'c', kg: 1 }];
    const cols: Array<ColumnaTabla<{ id: string; kg: number }>> = [{ clave: 'kg', titulo: 'Kg', valorOrden: f => f.kg }];
    expect(ordenarFilas(iguales, { columna: 'kg', sentido: 'desc' }, cols).map(f => f.id)).toEqual(['a', 'b', 'c']);
    const sinOrden = ordenarFilas(FILAS, SIN_ORDEN, COLUMNAS);
    expect(sinOrden).toEqual(FILAS);
    expect(sinOrden).not.toBe(FILAS);
    expect(ordenarFilas(FILAS, { columna: 'accion', sentido: 'asc' }, COLUMNAS)).toEqual(FILAS);
  });

  it('compara fechas y booleanos', () => {
    expect(compararValores(new Date('2026-01-01'), new Date('2026-02-01'))).toBeLessThan(0);
    expect(compararValores(true, false)).toBeGreaterThan(0);
    expect(compararValores(null, 1)).toBeGreaterThan(0);
  });
});

describe('TablaDatos: agrupación, totales y paginación', () => {
  it('agrupa conservando el orden de primera aparición y el orden interno', () => {
    const g = agruparFilas(FILAS, { clave: f => f.cat, titulo: c => c.toUpperCase() });
    expect(g.map(x => x.clave)).toEqual(['PCB', 'Ferroso']);
    expect(g.map(x => x.titulo)).toEqual(['PCB', 'FERROSO']);
    expect(g[0].filas.map(f => f.id)).toEqual(['1', '3']);
  });

  it('ordena DENTRO de cada grupo y permite ordenar los grupos entre sí', () => {
    const g = agruparFilas(FILAS, { clave: f => f.cat });
    const o = ordenarGrupos(g, { columna: 'kg', sentido: 'desc' }, COLUMNAS, (a, b) => a.clave.localeCompare(b.clave));
    expect(o.map(x => x.clave)).toEqual(['Ferroso', 'PCB']);
    expect(o[0].filas.map(f => f.id)).toEqual(['4', '2']);
    expect(o[1].filas.map(f => f.id)).toEqual(['3', '1']);
    expect(g[0].filas.map(f => f.id)).toEqual(['1', '3']);
  });

  it('totaliza ignorando vacíos y no finitos', () => {
    expect(sumar([1, 2, null, undefined, Number.NaN, Number.POSITIVE_INFINITY, 3.5])).toBe(6.5);
    expect(COLUMNAS[1].total?.(FILAS)).toBe(350);
  });

  it('pagina y acota la página al rango válido', () => {
    const p = paginar([1, 2, 3, 4, 5], 2, 2);
    expect(p).toMatchObject({ filas: [3, 4], pagina: 2, paginas: 3, total: 5, desde: 3, hasta: 4 });
    expect(paginar([1, 2, 3], 99, 2).pagina).toBe(2);
    expect(paginar([1, 2, 3], -4, 2).pagina).toBe(1);
    expect(paginar([], 1, 10)).toMatchObject({ filas: [], paginas: 1, desde: 0, hasta: 0 });
    expect(paginar([1, 2], 1, 0).paginas).toBe(2);
  });

  it('valorATexto usa formato es-VE y "—" para vacíos', () => {
    expect(valorATexto(1234)).toBe('1.234');
    expect(valorATexto(12.5)).toBe('12,50');
    expect(valorATexto(null)).toBe('—');
    expect(valorATexto(Number.NaN)).toBe('—');
    expect(valorATexto(true)).toBe('Sí');
    expect(valorATexto(new Date(2026, 9, 4))).toBe('04/10/2026');
  });

  it('las columnas exportables excluyen las marcadas con valorCsv:false y las sin valor', () => {
    const cols = columnasParaCsv(COLUMNAS);
    expect(cols.map(c => c.titulo)).toEqual(['Nombre', 'Kg']);
    expect(cols[1].decimales).toBe(1);
    const csv = construirCsv(cols, ordenarFilas(FILAS, { columna: 'kg', sentido: 'desc' }, COLUMNAS));
    expect(csv.slice(1).split('\r\n')[1]).toBe('Lote 1;200');
  });
});

describe('filtros <-> URL (esquema genérico)', () => {
  const ESQUEMA: EsquemaFiltros = {
    campos: {
      desde: { tipo: 'fecha' },
      hasta: { tipo: 'fecha' },
      q: { tipo: 'texto' },
      estado: { tipo: 'opcion', opciones: ['pagada', 'pendiente'] },
      archivadas: { tipo: 'bandera' },
    },
    rangos: [['desde', 'hasta']],
  };
  const p = (s: string) => new URLSearchParams(s);

  it('lee valores válidos y descarta los inválidos', () => {
    const v = leerFiltros(p('desde=2026-10-01&hasta=2026-10-31&q=%20pcb%20&estado=pagada&archivadas=1'), ESQUEMA);
    expect(v).toEqual({ desde: '2026-10-01', hasta: '2026-10-31', q: 'pcb', estado: 'pagada', archivadas: true });
    expect(leerFiltros(p('estado=hackeado&archivadas=si&q=%20%20'), ESQUEMA)).toEqual({});
  });

  it('descarta el rango si falta un extremo, está invertido o la fecha es imposible', () => {
    expect(leerFiltros(p('desde=2026-10-01'), ESQUEMA)).toEqual({});
    expect(leerFiltros(p('desde=2026-10-31&hasta=2026-10-01'), ESQUEMA)).toEqual({});
    expect(leerFiltros(p('desde=2026-02-30&hasta=2026-03-01'), ESQUEMA)).toEqual({});
  });

  it('escribe los cambios sin tocar claves ajenas al esquema y borra con undefined/false/vacío', () => {
    const r = escribirFiltros(p('tab=resumen&q=viejo'), ESQUEMA, { q: 'nuevo', estado: 'pendiente', archivadas: true });
    expect(r.toString()).toBe('tab=resumen&q=nuevo&estado=pendiente&archivadas=1');
    const b = escribirFiltros(r, ESQUEMA, { q: undefined, archivadas: false, estado: '' });
    expect(b.toString()).toBe('tab=resumen');
  });

  it('el orden de las claves escritas es estable (el del esquema)', () => {
    const r = escribirFiltros(p(''), ESQUEMA, { estado: 'pagada', q: 'x', hasta: '2026-10-31', desde: '2026-10-01' });
    expect(r.toString()).toBe('desde=2026-10-01&hasta=2026-10-31&q=x&estado=pagada');
  });

  it('rechaza al escribir valores inválidos y claves desconocidas', () => {
    const r = escribirFiltros(p(''), ESQUEMA, { estado: 'otro', desde: 'ayer', zzz: 'a' });
    expect(r.toString()).toBe('');
  });

  it('un cambio que deja el rango incompleto o invertido lo descarta completo', () => {
    const base = p('desde=2026-10-01&hasta=2026-10-31');
    expect(escribirFiltros(base, ESQUEMA, { hasta: undefined }).toString()).toBe('');
    expect(escribirFiltros(base, ESQUEMA, { desde: '2026-11-15' }).toString()).toBe('');
    expect(escribirFiltros(base, ESQUEMA, { desde: '2026-10-10' }).toString()).toBe('desde=2026-10-10&hasta=2026-10-31');
  });

  it('limpia solo los filtros del esquema', () => {
    expect(limpiarFiltros(p('tab=x&q=a&estado=pagada'), ESQUEMA).toString()).toBe('tab=x');
  });

  it('ida y vuelta: lo escrito se lee igual', () => {
    const cambios = { desde: '2026-10-01', hasta: '2026-10-31', q: 'tarjetas ñ', estado: 'pendiente', archivadas: true } as const;
    expect(leerFiltros(escribirFiltros(p(''), ESQUEMA, cambios), ESQUEMA)).toEqual(cambios);
  });

  it('cuenta filtros activos', () => {
    expect(contarFiltrosActivos({ q: 'a', estado: undefined, archivadas: true })).toBe(2);
    expect(contarFiltrosActivos({ q: 'a', estado: 'x' }, ['estado'])).toBe(1);
  });
});

describe('gráficas: escalas y redondeo', () => {
  it('numeroBonito redondea a 1, 2, 5 x 10^n', () => {
    expect(numeroBonito(6, true)).toBe(5);
    expect(numeroBonito(8, true)).toBe(10);
    expect(numeroBonito(1.2, false)).toBe(2);
    expect(numeroBonito(130, false)).toBe(200);
    expect(numeroBonito(0, true)).toBe(1);
  });

  it('calcularEjeY arranca en 0, termina en múltiplo del paso y cubre el máximo', () => {
    const e = calcularEjeY(0, 1234, 4);
    expect(e.min).toBe(0);
    expect(e.max).toBeGreaterThanOrEqual(1234);
    expect(e.ticks[0]).toBe(0);
    expect(e.ticks[e.ticks.length - 1]).toBe(e.max);
    expect(e.ticks.length).toBeLessThanOrEqual(7);
    expect(e.ticks.every(t => Math.abs(t / e.paso - Math.round(t / e.paso)) < 1e-9)).toBe(true);
  });

  it('calcularEjeY maneja ceros, decimales pequeños y negativos', () => {
    expect(calcularEjeY(0, 0)).toEqual({ min: 0, max: 1, paso: 1, ticks: [0, 1] });
    const dec = calcularEjeY(0, 0.3, 3);
    expect(dec.max).toBeGreaterThanOrEqual(0.3);
    expect(dec.ticks).toEqual([0, 0.2, 0.4]);
    expect(calcularEjeY(0, 0.6, 6)).toMatchObject({ max: 0.6, paso: 0.2, ticks: [0, 0.2, 0.4, 0.6] });
    const neg = calcularEjeY(-50, 100, 4);
    expect(neg.min).toBeLessThanOrEqual(-50);
    expect(neg.max).toBeGreaterThanOrEqual(100);
    expect(neg.ticks).toContain(0);
  });

  it('escalaLineal mapea dominio a rango y tolera dominio degenerado', () => {
    const y = escalaLineal(0, 100, 200, 0);
    expect(y(0)).toBe(200);
    expect(y(50)).toBe(100);
    expect(y(100)).toBe(0);
    expect(escalaLineal(5, 5, 0, 10)(5)).toBe(5);
  });

  it('posicionesX reparte puntos, con uno solo al centro', () => {
    expect(posicionesX(3, 0, 100)).toEqual([0, 50, 100]);
    expect(posicionesX(1, 0, 100)).toEqual([50]);
    expect(posicionesX(0, 0, 100)).toEqual([]);
  });

  it('rutaLinea y rutaArea generan rutas SVG cerradas correctamente', () => {
    const pts = [{ x: 0, y: 10 }, { x: 50, y: 5.123 }, { x: 100, y: 0 }];
    expect(rutaLinea(pts)).toBe('M0 10 L50 5.12 L100 0');
    expect(rutaArea(pts, 20)).toBe('M0 10 L50 5.12 L100 0 L100 20 L0 20 Z');
    expect(rutaLinea([])).toBe('');
    expect(rutaArea([], 20)).toBe('');
  });

  it('indiceMasCercano elige el punto más próximo', () => {
    expect(indiceMasCercano([0, 50, 100], 70)).toBe(1);
    expect(indiceMasCercano([0, 50, 100], 80)).toBe(2);
    expect(indiceMasCercano([], 5)).toBe(-1);
  });

  it('porcentajesDeMaximo y apilarCategoria ignoran negativos y no finitos', () => {
    expect(porcentajesDeMaximo([10, 5, -3, Number.NaN])).toEqual([100, 50, 0, 0]);
    expect(porcentajesDeMaximo([0, 0])).toEqual([0, 0]);
    const a = apilarCategoria([3, -1, 2]);
    expect(a.total).toBe(5);
    expect(a.segmentos.map(s => [s.desde, s.hasta])).toEqual([[0, 3], [3, 3], [3, 5]]);
  });

  it('geometriaBarras deja hueco proporcional y centra cada barra', () => {
    const g = geometriaBarras(4, 400, 0.5);
    expect(g.paso).toBe(100);
    expect(g.ancho).toBe(50);
    expect(g.xs).toEqual([25, 125, 225, 325]);
    expect(geometriaBarras(0, 400).xs).toEqual([]);
  });

  it('resumirSerie y variacionPct', () => {
    expect(resumirSerie([4, 1, 7, Number.NaN])).toEqual({ total: 12, promedio: 4, min: 1, max: 7, indiceMin: 1, indiceMax: 2 });
    expect(resumirSerie([])).toBeNull();
    expect(variacionPct(150, 100)).toBe(50);
    expect(variacionPct(50, -100)).toBe(150);
    expect(variacionPct(5, 0)).toBeNull();
    expect(variacionPct(5, null)).toBeNull();
  });
});

describe('dona: máximo 5 porciones + Otros', () => {
  it('con 5 o menos no crea "Otros" y ordena de mayor a menor', () => {
    const p = porcionesDona([{ etiqueta: 'a', valor: 10 }, { etiqueta: 'b', valor: 30 }, { etiqueta: 'c', valor: 60 }]);
    expect(p.map(x => x.etiqueta)).toEqual(['c', 'b', 'a']);
    expect(p.some(x => x.esOtros)).toBe(false);
    expect(p.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100, 6);
  });

  it('con más de 5 agrupa el resto en "Otros" (nunca más de 6 porciones)', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ etiqueta: `m${i}`, valor: 100 - i * 10 }));
    const p = porcionesDona(items);
    expect(p).toHaveLength(6);
    expect(p[5]).toMatchObject({ etiqueta: 'Otros', esOtros: true });
    expect(p[5].valor).toBe(items.slice(5).reduce((s, i) => s + i.valor, 0));
    expect(p.slice(0, 5).map(x => x.etiqueta)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
  });

  it('un máximo mayor que 5 se limita a 5', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ etiqueta: `m${i}`, valor: i + 1 }));
    expect(porcionesDona(items, 20)).toHaveLength(6);
    expect(porcionesDona(items, 2)).toHaveLength(3);
  });

  it('descarta valores no positivos y devuelve vacío si no queda nada', () => {
    expect(porcionesDona([{ etiqueta: 'a', valor: 0 }, { etiqueta: 'b', valor: -5 }, { etiqueta: 'c', valor: Number.NaN }])).toEqual([]);
    expect(porcionesDona([])).toEqual([]);
  });

  it('los ángulos empiezan arriba y dan una vuelta completa', () => {
    const a = angulosDona([{ pct: 25 }, { pct: 75 }]);
    expect(a[0][0]).toBeCloseTo(-Math.PI / 2, 9);
    expect(a[1][1]).toBeCloseTo(-Math.PI / 2 + Math.PI * 2, 9);
    expect(a[0][1]).toBeCloseTo(a[1][0], 9);
  });

  it('un sector grande usa el flag de arco grande; el 100 % se dibuja con dos medios arcos', () => {
    const chico = rutaArco(60, 60, 56, 36, 0, Math.PI / 2);
    const grande = rutaArco(60, 60, 56, 36, 0, Math.PI * 1.5);
    expect(chico).toContain('A56 56 0 0 1');
    expect(grande).toContain('A56 56 0 1 1');
    const lleno = rutaArco(60, 60, 56, 36, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2);
    expect((lleno.match(/A56 56/g) ?? []).length).toBe(2);
    expect((lleno.match(/A36 36/g) ?? []).length).toBe(2);
    expect(lleno).not.toContain('NaN');
  });
});
