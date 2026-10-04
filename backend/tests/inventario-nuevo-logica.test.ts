import { describe, it, expect } from 'vitest';
import {
  atajoActivo,
  calcularFaltanKg,
  calcularProgresoPct,
  compararConPeriodoAnterior,
  contarFiltrosAvanzados,
  derivarKpis,
  esFechaIso,
  filtrosAUrl,
  filtrosDesdeUrl,
  formatearKg,
  formatearNumero,
  formatearPct,
  formatearUsd,
  parametrosResumen,
  rangoDeAtajo,
} from '../../frontend/src/lib/inventario-nuevo';
import {
  COLORES_CATEGORIA,
  ESTILO_CATEGORIA_DESCONOCIDA,
  colorCategoria,
  estiloCategoria,
  normalizarNombreCategoria,
} from '../../frontend/src/lib/colores-categoria';

describe('formateo es-VE con unidad', () => {
  it('separa miles con punto incluso en 4 cifras y decimales con coma', () => {
    expect(formatearNumero(1234)).toBe('1.234');
    expect(formatearNumero(1234567.891, 2)).toBe('1.234.567,89');
    expect(formatearNumero(999)).toBe('999');
    expect(formatearNumero(0.5, 1)).toBe('0,5');
  });
  it('agrega la unidad', () => {
    expect(formatearKg(18000)).toBe('18.000,00 kg');
    expect(formatearUsd(12345.6)).toBe('USD 12.346');
    expect(formatearPct(5.25)).toBe('5,3 %');
  });
  it('maneja negativos, cero negativo y valores no finitos', () => {
    expect(formatearNumero(-1500)).toBe('-1.500');
    expect(formatearNumero(-0.001, 1)).toBe('0,0');
    expect(formatearNumero(Number.NaN)).toBe('—');
  });
});

describe('contenedor: faltantes y progreso', () => {
  it('calcula lo que falta y nunca es negativo', () => {
    expect(calcularFaltanKg(18000, 4500)).toBe(13500);
    expect(calcularFaltanKg(18000, 20000)).toBe(0);
    expect(calcularFaltanKg(18000, -5)).toBe(18000);
  });
  it('con meta inválida no hay faltante ni progreso', () => {
    expect(calcularFaltanKg(0, 100)).toBe(0);
    expect(calcularProgresoPct(0, 100)).toBe(0);
  });
  it('el progreso se acota a 0-100', () => {
    expect(calcularProgresoPct(18000, 9000)).toBe(50);
    expect(calcularProgresoPct(18000, 36000)).toBe(100);
    expect(calcularProgresoPct(18000, -1)).toBe(0);
  });
});

describe('comparación vs periodo anterior', () => {
  it('sin dato anterior devuelve null (se muestra "—")', () => {
    expect(compararConPeriodoAnterior(5, null, 'baja')).toBeNull();
    expect(compararConPeriodoAnterior(5, undefined, 'baja')).toBeNull();
    expect(compararConPeriodoAnterior(5, Number.NaN, 'baja')).toBeNull();
  });
  it('merma que baja es buena; que sube es mala', () => {
    expect(compararConPeriodoAnterior(4, 6, 'baja')).toMatchObject({ direccion: 'baja', tono: 'bueno', delta: -2 });
    expect(compararConPeriodoAnterior(7, 6, 'baja')).toMatchObject({ direccion: 'sube', tono: 'malo' });
  });
  it('un KPI donde subir es bueno invierte el tono', () => {
    expect(compararConPeriodoAnterior(10, 5, 'sube')).toMatchObject({ tono: 'bueno', deltaPct: 100 });
    expect(compararConPeriodoAnterior(3, 5, 'sube')).toMatchObject({ tono: 'malo' });
  });
  it('igual es neutro y con anterior 0 no hay porcentaje', () => {
    expect(compararConPeriodoAnterior(5, 5, 'baja')).toMatchObject({ direccion: 'igual', tono: 'neutro' });
    expect(compararConPeriodoAnterior(5, 0, 'sube')).toMatchObject({ direccion: 'sube', deltaPct: null });
  });
});

describe('normalización de categorías y colores', () => {
  it('ignora tildes, mayúsculas, guiones y espacios', () => {
    expect(normalizarNombreCategoria('  NO-Ferroso ')).toBe('no ferroso');
    expect(normalizarNombreCategoria('Ñandú Ácido')).toBe('nandu acido');
  });
  it('resuelve variantes al estilo canónico', () => {
    expect(estiloCategoria('no ferroso').nombre).toBe('No ferroso');
    expect(estiloCategoria('NO-FERROSO')).toBe(COLORES_CATEGORIA['No ferroso']);
    expect(estiloCategoria('procesador').nombre).toBe('Procesadores');
    expect(estiloCategoria('pcb')).toBe(COLORES_CATEGORIA.PCB);
  });
  it('lo desconocido o vacío cae en un estilo neutro, sin lanzar', () => {
    expect(estiloCategoria('Otra cosa')).toBe(ESTILO_CATEGORIA_DESCONOCIDA);
    expect(estiloCategoria(null)).toBe(ESTILO_CATEGORIA_DESCONOCIDA);
  });
  it('cada categoría tiene color y símbolo propios (no depende solo del color) y ninguno es rojo', () => {
    const estilos = Object.values(COLORES_CATEGORIA);
    expect(estilos).toHaveLength(7);
    expect(new Set(estilos.map(e => e.color)).size).toBe(7);
    expect(new Set(estilos.map(e => e.simbolo)).size).toBe(7);
    for (const e of estilos) {
      const [r, g, b] = [1, 3, 5].map(i => parseInt(e.color.slice(i, i + 2), 16));
      expect(r > 180 && g < 90 && b < 90).toBe(false);
    }
    expect(colorCategoria('PGM')).toBe('#E69F00');
  });
});

describe('filtros <-> URL', () => {
  it('ida y vuelta conserva los filtros válidos', () => {
    const f = { desde: '2026-09-01', hasta: '2026-09-30', categoria: 'PCB', q: 'cobre', almacen: 'a1', proveedor: 'p1', etapa: 'listo' as const, lote: 'l1' };
    expect(filtrosDesdeUrl(filtrosAUrl(f))).toEqual(f);
  });
  it('omite claves vacías y mantiene un orden estable', () => {
    expect(filtrosAUrl({ q: 'x', categoria: 'PCB', desde: undefined }).toString()).toBe('categoria=PCB&q=x');
  });
  it('descarta fechas inválidas, rango invertido, rango incompleto y etapas desconocidas', () => {
    expect(filtrosDesdeUrl(new URLSearchParams('desde=2026-13-45&hasta=2026-09-30')).desde).toBeUndefined();
    expect(filtrosDesdeUrl(new URLSearchParams('desde=2026-09-30&hasta=2026-09-01'))).toMatchObject({ desde: undefined, hasta: undefined });
    expect(filtrosDesdeUrl(new URLSearchParams('desde=2026-09-01'))).toMatchObject({ desde: undefined, hasta: undefined });
    expect(filtrosDesdeUrl(new URLSearchParams('etapa=otra')).etapa).toBeUndefined();
  });
  it('recorta espacios y trata vacío como ausente', () => {
    const f = filtrosDesdeUrl(new URLSearchParams('q=%20%20&categoria=%20PGM%20'));
    expect(f.q).toBeUndefined();
    expect(f.categoria).toBe('PGM');
  });
  it('esFechaIso rechaza el 31 de febrero', () => {
    expect(esFechaIso('2026-02-31')).toBe(false);
    expect(esFechaIso('2026-02-28')).toBe(true);
  });
  it('cuenta solo los filtros de "Más filtros" y arma parámetros del resumen solo con rango completo', () => {
    expect(contarFiltrosAvanzados({ almacen: 'a', etapa: 'listo', q: 'x', categoria: 'PCB' })).toBe(2);
    expect(parametrosResumen({ desde: '2026-09-01', hasta: '2026-09-30', q: 'x' })).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' });
    expect(parametrosResumen({ desde: '2026-09-01' })).toEqual({});
  });
});

describe('atajos de fechas', () => {
  const hoy = new Date('2026-10-04T00:00:00Z');
  it('calcula cada atajo (incluyendo hoy)', () => {
    expect(rangoDeAtajo('7d', hoy)).toEqual({ desde: '2026-09-28', hasta: '2026-10-04' });
    expect(rangoDeAtajo('30d', hoy)).toEqual({ desde: '2026-09-05', hasta: '2026-10-04' });
    expect(rangoDeAtajo('mes', hoy)).toEqual({ desde: '2026-10-01', hasta: '2026-10-04' });
    expect(rangoDeAtajo('todo', hoy).hasta).toBe('2026-10-04');
  });
  it('detecta el atajo activo; sin rango equivale a 30 días; rango propio = ninguno', () => {
    expect(atajoActivo({}, hoy)).toBe('30d');
    expect(atajoActivo(rangoDeAtajo('7d', hoy), hoy)).toBe('7d');
    expect(atajoActivo({ desde: '2026-08-01', hasta: '2026-08-15' }, hoy)).toBeNull();
  });
});

describe('derivarKpis', () => {
  const merma = (pct: number, entrada: number) => ({
    desde: '2026-09-01', hasta: '2026-09-30', transformaciones: entrada > 0 ? 3 : 0, kgEntrada: entrada, kgMerma: (entrada * pct) / 100,
    kgSalida: entrada - (entrada * pct) / 100, pctMerma: pct, tipos: [{ tipo: 'basura', kg: 20, pctDeMerma: 50, pctDeEntrada: 2 }],
    sinClasificar: { kg: 5, pctDeMerma: 10, pctDeEntrada: 0.5 },
  });
  const base = {
    totalKg: 1000,
    almacenes: [{ almacenId: 'a', nombre: 'G1', activo: true, totalKg: 600 }, { almacenId: 'b', nombre: 'Viejo', activo: false, totalKg: 0 }],
    exportacion: { stockKg: 500, listoKg: 300, enSacaKg: 200 },
    valorOculto: false,
    valor: {
      costoMateriales: { valorUsd: 5000, kgConCosto: 400, kgSinCosto: 100, kgNegativos: 0, productosSinCosto: [] },
      ventaEstimadaLotes: { valorUsd: 9000, kgConPrecio: 300, kgSinPrecio: 50, lotesSinPrecio: [] },
    },
    merma: { umbralPct: 8, actual: merma(6, 1000), anterior: merma(4, 0), variacion: { kgMerma: 0, pctMermaPuntos: null }, sobreUmbral: false, transformacionesAltas: [] },
  };
  // El cast es solo de prueba: derivarKpis lee únicamente estos campos.
  const kpis = (o: Record<string, unknown> = {}) => derivarKpis({ ...base, ...o } as never);

  it('toma costo y venta estimada por separado, sin sumarlos', () => {
    const k = kpis();
    expect(k.valor).toMatchObject({ oculto: false, costoUsd: 5000, ventaEstimadaUsd: 9000, kgConCosto: 400, kgSinCosto: 100 });
  });
  it('con valorOculto no entrega cifras (no un 0)', () => {
    const k = kpis({ valorOculto: true, valor: null });
    expect(k.valor).toMatchObject({ oculto: true, costoUsd: null, ventaEstimadaUsd: null });
  });
  it('listos sale de exportacion.listoKg y los almacenes inactivos en cero no se listan', () => {
    const k = kpis();
    expect(k.listos.kg).toBe(300);
    expect(k.galpon.almacenes).toEqual([{ nombre: 'G1', totalKg: 600 }]);
  });
  it('merma sin entradas en el periodo anterior no ofrece comparación', () => {
    expect(kpis().merma.pctAnterior).toBeNull();
    expect(kpis({ merma: { ...base.merma, anterior: merma(4, 500) } }).merma.pctAnterior).toBe(4);
    expect(kpis().merma.sinClasificarKg).toBe(5);
  });
});
