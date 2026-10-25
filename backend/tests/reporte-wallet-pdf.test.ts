import { describe, it, expect } from 'vitest';
import { descargarReporteCategoriasPDF, descargarReporteCuentaPDF } from '../../frontend/src/features/cochinito/categorias/reporte-wallet-pdf';
import type { ReporteCategorias, ReporteCuenta } from '../../shared/types/categoria-wallet';

const t = (moneda: string, ingresos: number, egresos: number) => ({ moneda, ingresos, egresos, total: ingresos - egresos });

const cuenta: ReporteCuenta = {
  banca: { id: 'b1', nombre: 'Banesco', moneda: 'USD' }, desde: '2026-10-01', hasta: '2026-10-31',
  filas: [
    { id: 'm1', fecha: '2026-10-02', tipo: 'ingreso', subtipo: null, numero: null, numeroSistema: 1, descripcion: 'Depósito', referencia: '', cuentaContraria: null,
      categoriaId: 'c1', categoria: { nombre: 'Ventas › Mayor', color: '#15803D' }, entrada: 100, salida: 0, anulado: false, enProceso: false },
    { id: 'm2', fecha: '2026-10-03', tipo: 'transferencia', subtipo: null, numero: null, numeroSistema: 2, descripcion: 'Traspaso', referencia: '', cuentaContraria: 'Cuenta restringida',
      categoriaId: null, categoria: null, entrada: 0, salida: 30, anulado: true, enProceso: false },
  ],
  totales: { entradas: 100, salidas: 0, neto: 100 },
};

const categorias: ReporteCategorias = {
  desde: '2026-10-01', hasta: '2026-10-31', movimientosExcluidosPorAcceso: 2, totalesGenerales: [t('USD', 100, 55), t('VES', 0, 4000)],
  grupos: [
    { categoriaId: 's', nombre: 'Servicios', color: '#15803D', movimientos: 2, totales: [t('USD', 100, 55)], subcategorias: [{ categoriaId: 'l', nombre: 'Luz', color: '#0369A1', movimientos: 1, totales: [t('USD', 0, 30)] }] },
    { categoriaId: 'n', nombre: 'Nómina', color: '#7E22CE', movimientos: 1, totales: [t('VES', 0, 4000)], subcategorias: [] },
  ],
};

const esPdf = async (b: Blob) => new TextDecoder().decode((await b.arrayBuffer()).slice(0, 5));

describe('PDF de reportes del Wallet (humo)', () => {
  it('reporte de cuenta genera un PDF', async () => {
    const a = await descargarReporteCuentaPDF(cuenta, 'blob');
    expect(a?.nombre).toBe('Movimientos-2026-10-01-a-2026-10-31-Banesco.pdf');
    expect(await esPdf(a!.blob)).toBe('%PDF-');
  });
  it('reporte por categorías genera un PDF, con varias monedas y también vacío', async () => {
    const a = await descargarReporteCategoriasPDF(categorias, 'Todas las categorías', 'blob');
    expect(await esPdf(a!.blob)).toBe('%PDF-');
    const vacio = await descargarReporteCategoriasPDF({ ...categorias, grupos: [], totalesGenerales: [] }, 'Todas las categorías', 'blob');
    expect(await esPdf(vacio!.blob)).toBe('%PDF-');
  });
});
