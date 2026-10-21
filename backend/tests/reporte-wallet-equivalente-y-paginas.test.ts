import { describe, it, expect } from 'vitest';
import { equivalenteUsd, tasaVigenteA, type TasaHistorica } from '../src/utils/equivalente-usd.js';
import { construirReporteCuenta, type MovimientoReporte } from '../src/utils/reporte-wallet.js';
import {
  FILAS_POR_PAGINA_PDF, filtrarFilasPorCorrelativo, partirEnTrozos, totalesDeFilas,
} from '../../frontend/src/features/cochinito/categorias/reporte-wallet-datos';
import type { FilaReporteCuenta } from '../../shared/types/categoria-wallet';

const tasas: TasaHistorica[] = [
  { tasa: 36, fecha: '2026-10-01T12:00:00Z', fuente: 'BCV' },
  { tasa: 40, fecha: '2026-10-10T12:00:00Z', fuente: 'BCV' },
  { tasa: 50, fecha: '2026-10-11T12:00:00Z', fuente: 'Binance' },
];
const base = { moneda: 'VES', monto: 3600, montoUsd: null, fecha: '2026-10-05', importeEnMonedaOrigen: true };

describe('tasaVigenteA', () => {
  it('toma la más reciente que no sea posterior al movimiento y prefiere BCV', () => {
    expect(tasaVigenteA(tasas, '2026-10-05')).toBe(36);
    expect(tasaVigenteA(tasas, '2026-10-10T13:00:00Z')).toBe(40);
    expect(tasaVigenteA(tasas, '2026-10-20')).toBe(40);
  });
  it('sin tasa anterior o con fecha inválida devuelve null', () => {
    expect(tasaVigenteA(tasas, '2026-09-30')).toBeNull();
    expect(tasaVigenteA([], '2026-10-05')).toBeNull();
    expect(tasaVigenteA(tasas, 'no-es-fecha')).toBeNull();
  });
  it('sin BCV usa otra fuente', () => {
    expect(tasaVigenteA([{ tasa: 50, fecha: '2026-10-11T12:00:00Z', fuente: 'Binance' }], '2026-10-12')).toBe(50);
  });
});

describe('equivalenteUsd', () => {
  it('usa monto_usd del movimiento (proporcional al importe) antes que la tasa histórica', () => {
    expect(equivalenteUsd(3600, { ...base, montoUsd: 100 }, tasas)).toBe(100);
    expect(equivalenteUsd(1800, { ...base, montoUsd: 100 }, tasas)).toBe(50);
  });
  it('sin monto_usd usa la tasa histórica; sin tasa devuelve null (no inventa)', () => {
    expect(equivalenteUsd(3600, base, tasas)).toBe(100);
    expect(equivalenteUsd(3600, { ...base, fecha: '2026-09-01' }, tasas)).toBeNull();
  });
  it('importe cero o negativo devuelve null; si el importe no está en la moneda origen ignora monto_usd', () => {
    expect(equivalenteUsd(0, base, tasas)).toBeNull();
    expect(equivalenteUsd(400, { ...base, montoUsd: 1, importeEnMonedaOrigen: false }, tasas)).toBe(11.11);
  });
});

const mov = (o: Partial<MovimientoReporte>): MovimientoReporte => ({
  id: 'm', tipo: 'ingreso', subtipo: null, numero: null, numeroSistema: 1, monto: 3600, moneda: 'VES', montoDestino: null, fecha: '2026-10-05',
  descripcion: '', referencia: '', bancaOrigenId: 'b1', bancaDestinoId: null, categoriaId: null, anulado: false, mesaCambistaId: null, mesaEstado: null, ...o,
});

describe('construirReporteCuenta: equivalente USD', () => {
  const e = { bancaId: 'b1', categorias: [], nombresBancas: new Map<string, string>(), permitidas: null, monedaCuenta: 'VES', tasas } as const;

  it('en cuenta Bs: monto_usd del pago, tasa histórica en manuales y null sin tasa', () => {
    const r = construirReporteCuenta({
      ...e,
      movimientos: [
        mov({ id: 'a', numeroSistema: 1, montoUsd: 90 }),
        mov({ id: 'b', numeroSistema: 2, tipo: 'egreso', monto: 720 }),
        mov({ id: 'c', numeroSistema: 3, fecha: '2026-09-01' }),
      ],
    });
    expect(r.filas.map(f => f.equivalenteUsd)).toEqual([null, 90, 20]);
  });
  it('en cuenta USD no calcula equivalente', () => {
    const r = construirReporteCuenta({ ...e, monedaCuenta: 'USD', movimientos: [mov({ moneda: 'USD' })] });
    expect(r.filas[0].equivalenteUsd).toBeNull();
  });
  it('los totales no cambian por el equivalente', () => {
    const r = construirReporteCuenta({ ...e, movimientos: [mov({ monto: 100 }), mov({ id: 'x', tipo: 'egreso', monto: 40 })] });
    expect(r.totales).toEqual({ entradas: 100, salidas: 40, neto: 60 });
  });
});

describe('partirEnTrozos', () => {
  it('usa 15 por página por defecto y deja el resto en el último trozo', () => {
    expect(FILAS_POR_PAGINA_PDF).toBe(15);
    const trozos = partirEnTrozos(Array.from({ length: 31 }, (_, i) => i));
    expect(trozos.map(t => t.length)).toEqual([15, 15, 1]);
    expect(trozos.flat()).toEqual(Array.from({ length: 31 }, (_, i) => i));
  });
  it('exactamente 15 es una sola página; vacío no genera trozos; no muta la entrada', () => {
    const quince = Array.from({ length: 15 }, (_, i) => i);
    expect(partirEnTrozos(quince)).toHaveLength(1);
    expect(partirEnTrozos([])).toEqual([]);
    expect(quince).toHaveLength(15);
  });
  it('rechaza tamaños menores que 1', () => {
    expect(() => partirEnTrozos([1], 0)).toThrow();
  });
});

const fila = (o: Partial<FilaReporteCuenta>): FilaReporteCuenta => ({
  id: 'f', fecha: '2026-10-05', tipo: 'ingreso', subtipo: null, numero: null, numeroSistema: null, descripcion: '', referencia: '', cuentaContraria: null,
  categoriaId: null, categoria: null, entrada: 0, salida: 0, anulado: false, enProceso: false, ...o,
});

describe('filtrarFilasPorCorrelativo y totalesDeFilas', () => {
  const filas = [
    fila({ id: '1', numeroSistema: 1, entrada: 100 }),
    fila({ id: '12', numeroSistema: 12, salida: 30 }),
    fila({ id: 'pg', subtipo: 'pago', numero: 3, salida: 5, anulado: true }),
    fila({ id: 'old', numero: 123, entrada: 7 }),
  ];
  it('busca por código MV, sin distinguir mayúsculas, y por número exacto', () => {
    expect(filtrarFilasPorCorrelativo(filas, 'mv-0012').map(f => f.id)).toEqual(['12']);
    expect(filtrarFilasPorCorrelativo(filas, 'MV-00').map(f => f.id)).toEqual(['1', '12']);
    expect(filtrarFilasPorCorrelativo(filas, '12').map(f => f.id)).toEqual(['12', 'old']);
    expect(filtrarFilasPorCorrelativo(filas, 'pg').map(f => f.id)).toEqual(['pg']);
  });
  it('texto vacío devuelve todas (copia) y sin coincidencias devuelve vacío', () => {
    expect(filtrarFilasPorCorrelativo(filas, '  ')).toEqual(filas);
    expect(filtrarFilasPorCorrelativo(filas, 'zzz')).toEqual([]);
  });
  it('los totales de las filas filtradas ignoran las anuladas', () => {
    expect(totalesDeFilas(filas)).toEqual({ entradas: 107, salidas: 30, neto: 77 });
    expect(totalesDeFilas(filtrarFilasPorCorrelativo(filas, 'pg'))).toEqual({ entradas: 0, salidas: 0, neto: 0 });
  });
});

describe('PDF paginado a 15 filas', () => {
  const paginas = async (n: number, moneda = 'VES') => {
    const { descargarReporteCuentaPDF } = await import('../../frontend/src/features/cochinito/categorias/reporte-wallet-pdf');
    const filas = Array.from({ length: n }, (_, i) => fila({ id: `f${i}`, numeroSistema: i + 1, entrada: 10, descripcion: 'x', equivalenteUsd: 1 }));
    const a = await descargarReporteCuentaPDF(
      { banca: { id: 'b', nombre: 'Caja', moneda }, desde: '2026-10-01', hasta: '2026-10-31', filas, totales: totalesDeFilas(filas) }, 'blob');
    const texto = new TextDecoder('latin1').decode(await a!.blob.arrayBuffer());
    return (texto.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  };
  it('15 movimientos caben en una página; 16 y 31 usan 2 y 3', async () => {
    expect(await paginas(15)).toBe(1);
    expect(await paginas(16)).toBe(2);
    expect(await paginas(31)).toBe(3);
  });
});
