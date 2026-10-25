import { describe, it, expect } from 'vitest';
import { generarXlsx } from '../../frontend/src/lib/xlsx';
import {
  hojaReporteCuenta, hojasReporteCategorias, nombreXlsxReporteCategorias, nombreXlsxReporteCuenta,
} from '../../frontend/src/features/cochinito/categorias/reporte-wallet-xlsx';
import type { ReporteCategorias, ReporteCuenta } from '../../shared/types/categoria-wallet';
import { leerXlsx } from './helpers/leer-xlsx';

const t = (moneda: string, ingresos: number, egresos: number) => ({ moneda, ingresos, egresos, total: ingresos - egresos });

const cuentaBs: ReporteCuenta = {
  banca: { id: 'b1', nombre: 'Banesco', moneda: 'VES' }, desde: '2026-10-01', hasta: '2026-10-31',
  filas: [
    { id: 'm1', fecha: '2026-10-02', tipo: 'ingreso', subtipo: null, numero: null, numeroSistema: 1, descripcion: '=Depósito', referencia: 'R-1', cuentaContraria: null,
      categoriaId: 'c1', categoria: { nombre: 'Ventas › Mayor', color: '#15803D' }, entrada: 1000, salida: 0, anulado: false, enProceso: false, equivalenteUsd: 25.5, saldo: 1000 },
    { id: 'm2', fecha: '2026-10-03', tipo: 'transferencia', subtipo: null, numero: null, numeroSistema: 2, descripcion: 'Traspaso', referencia: '', cuentaContraria: 'Caja USD',
      categoriaId: null, categoria: null, entrada: 0, salida: 300, anulado: true, enProceso: false, equivalenteUsd: null, saldo: 1000 },
  ],
  totales: { entradas: 1000, salidas: 0, neto: 1000 },
};

const categorias: ReporteCategorias = {
  desde: '2026-10-01', hasta: '2026-10-31', movimientosExcluidosPorAcceso: 2, totalesGenerales: [t('USD', 100, 55), t('VES', 0, 4000)],
  grupos: [
    { categoriaId: 's', nombre: 'Servicios', color: '#15803D', movimientos: 2, totales: [t('USD', 100, 55)], subcategorias: [{ categoriaId: 'l', nombre: 'Luz', color: '#0369A1', movimientos: 1, totales: [t('USD', 0, 30)] }] },
    { categoriaId: 'n', nombre: 'Nómina', color: '#7E22CE', movimientos: 1, totales: [t('VES', 0, 4000)], subcategorias: [] },
  ],
};

describe('Excel: reporte de cuenta', () => {
  it('lleva cabecera, todas las filas con números y fechas reales, equivalente USD y totales de la vista', async () => {
    const [h] = await leerXlsx(await generarXlsx([hojaReporteCuenta(cuentaBs)]));
    expect(h.nombre).toBe('Movimientos');
    expect(h.fila(1)[0]).toBe('Movimientos de la cuenta');
    expect(h.fila(2)[0]).toBe('Banesco · Bs');
    expect(h.fila(5)).toEqual(['Fecha', 'N°', 'Tipo', 'Descripción', 'Referencia', 'Cuenta contraria', 'Categoría', 'Entra (Bs)', 'Sale (Bs)', 'Saldo (Bs)', 'Equiv. USD', 'Estado']);
    expect(h.negrita('A5')).toBe(true);
    expect(h.filasFijas).toBe(5);
    expect(h.fila(6)).toEqual(['2026-10-02', 'MV-0001', 'Ingreso', '=Depósito', 'R-1', undefined, 'Ventas › Mayor', 1000, undefined, 1000, 25.5, 'Vigente']);
    expect(h.fila(7)).toEqual(['2026-10-03', 'MV-0002', 'Transferencia', 'Traspaso', undefined, 'Caja USD', 'Sin categoría', undefined, undefined, 1000, undefined, 'Anulado']);
    expect(h.fila(9)[3]).toBe('Total que entra / sale');
    expect(h.fila(9)[7]).toBe(1000);
    expect(h.fila(9)[8]).toBe(0);
    expect(h.fila(10)[3]).toBe('Neto del periodo (Bs)');
    expect(h.fila(10)[7]).toBe(1000);
  });
  it('cuenta en USD no lleva columna de equivalente', () => {
    const hoja = hojaReporteCuenta({ ...cuentaBs, banca: { ...cuentaBs.banca, moneda: 'USD' } });
    expect(hoja.filas[4]).toHaveLength(11);
    expect(hoja.anchos).toHaveLength(11);
  });
  it('con búsqueda por N° lo avisa y rotula los totales como filtrados', () => {
    const hoja = hojaReporteCuenta({ ...cuentaBs, filas: [cuentaBs.filas[0]], totales: { entradas: 1000, salidas: 0, neto: 1000 } }, ' MV-0001 ');
    expect(JSON.stringify(hoja.filas[2])).toContain('Filtrado por N°: MV-0001');
    expect(JSON.stringify(hoja.filas)).toContain('Neto de las filas filtradas');
    expect(hoja.filas).toHaveLength(5 + 1 + 1 + 2);
  });
  it('no muta el reporte y nombra el archivo con cuenta y periodo', () => {
    const copia = JSON.stringify(cuentaBs);
    hojaReporteCuenta(cuentaBs);
    expect(JSON.stringify(cuentaBs)).toBe(copia);
    expect(nombreXlsxReporteCuenta(cuentaBs)).toBe('Reporte-Banesco-2026-10-01-a-2026-10-31.xlsx');
  });
});

describe('Excel: reporte por categorías', () => {
  it('una hoja por moneda con categoría/subcategoría planas y total general', async () => {
    const hojas = await leerXlsx(await generarXlsx(hojasReporteCategorias(categorias, 'Todas las categorías')));
    expect(hojas.map(h => h.nombre)).toEqual(['Categorías USD', 'Categorías Bs']);
    const usd = hojas[0];
    expect(usd.fila(2)[0]).toBe('Todas las categorías');
    expect(usd.fila(4)[0]).toBe('No incluye 2 movimientos de cuentas a las que no tienes acceso.');
    expect(usd.fila(6)).toEqual(['Categoría (USD)', 'Subcategoría', 'Ingresos', 'Egresos', 'Total']);
    expect(usd.fila(7)).toEqual(['Servicios', undefined, 100, 55, 45]);
    expect(usd.fila(8)).toEqual(['Servicios', 'Luz', 0, 30, -30]);
    expect(usd.negrita('A7')).toBe(true);
    expect(usd.negrita('B8')).toBe(false);
    expect(usd.fila(10)).toEqual(['Total general', undefined, 100, 55, 45]);
    expect(hojas[1].fila(7)).toEqual(['Nómina', undefined, 0, 4000, -4000]);
  });
  it('sin movimientos deja una hoja con el aviso', async () => {
    const hojas = await leerXlsx(await generarXlsx(hojasReporteCategorias({ ...categorias, grupos: [], totalesGenerales: [] }, 'Todas las categorías')));
    expect(hojas).toHaveLength(1);
    expect(hojas[0].fila(5)[0]).toBe('No hay movimientos con estos filtros en el periodo.');
    expect(nombreXlsxReporteCategorias(categorias)).toBe('Reporte-categorias-2026-10-01-a-2026-10-31.xlsx');
  });
});
