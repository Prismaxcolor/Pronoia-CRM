/** Reportes del Wallet en Excel. Las hojas se arman con las mismas filas y totales que la pantalla y el PDF
 *  (reporte-wallet-datos.ts); aquí no hay React ni DOM salvo `descargar...`. Se prueba en backend/tests/reporte-wallet-xlsx.test.ts. */

import type { ReporteCategorias, ReporteCuenta } from '@shared/types/index.js';
import type { Row } from 'write-excel-file/universal';
import {
  celdaCabecera, celdaFecha, celdaImporte, celdaTexto, celdaTitulo, descargarXlsx, nombreArchivoXlsx, textoGenerado, type HojaXlsx,
} from '../../../lib/xlsx';
import { formatearFecha, formatearNumero } from '../../../lib/formato';
import { numeroMovimiento } from '../detalle-movimiento';
import {
  etiquetaMoneda, filasPorMoneda, monedasDelReporte, textoMovimientosAcceso, textoTipoFila, totalGeneral,
} from './reporte-wallet-datos';

type FilaCuenta = ReporteCuenta['filas'][number];

const textoPeriodo = (desde: string, hasta: string): string => `Del ${formatearFecha(desde)} al ${formatearFecha(hasta)}`;
const estadoFila = (f: FilaCuenta): string => (f.anulado ? 'Anulado' : f.enProceso ? 'En proceso' : 'Vigente');

function cabeceraCuenta(moneda: string, conUsd: boolean): Row {
  return [
    celdaCabecera('Fecha'), celdaCabecera('N°'), celdaCabecera('Tipo'), celdaCabecera('Descripción'), celdaCabecera('Referencia'),
    celdaCabecera('Cuenta contraria'), celdaCabecera('Categoría'), celdaCabecera(`Entra (${moneda})`, true), celdaCabecera(`Sale (${moneda})`, true), celdaCabecera(`Saldo (${moneda})`, true),
    ...(conUsd ? [celdaCabecera('Equiv. USD', true)] : []), celdaCabecera('Estado'),
  ];
}

function filaCuenta(f: FilaCuenta, conUsd: boolean): Row {
  return [
    celdaFecha(f.fecha), celdaTexto(numeroMovimiento(f)), celdaTexto(textoTipoFila(f)), celdaTexto(f.descripcion), celdaTexto(f.referencia),
    celdaTexto(f.cuentaContraria), celdaTexto(f.categoria?.nombre ?? 'Sin categoría'), celdaImporte(f.anulado ? null : f.entrada || null), celdaImporte(f.anulado ? null : f.salida || null), celdaImporte(f.saldo ?? null),
    ...(conUsd ? [celdaImporte(f.anulado ? null : f.equivalenteUsd)] : []), celdaTexto(estadoFila(f)),
  ];
}

/** Filas de totales: etiqueta en la columna "Descripción" y el importe bajo Entra / Sale. Los anulados no cuentan (igual que la pantalla). */
function totalesCuenta(r: ReporteCuenta, conUsd: boolean, filtrado: boolean): Row[] {
  const sufijo = filtrado ? ' (solo filas filtradas)' : '';
  const hueco = (n: number): null[] => Array.from({ length: n }, () => null);
  const fila = (etiqueta: string, entra: number | null, sale: number | null): Row =>
    [...hueco(3), celdaTexto(etiqueta, true), ...hueco(3), celdaImporte(entra, true), celdaImporte(sale, true), null, ...(conUsd ? [null] : [])];
  return [
    fila(`Total que entra / sale${sufijo}`, r.totales.entradas, r.totales.salidas),
    fila(`${filtrado ? 'Neto de las filas filtradas' : 'Neto del periodo'} (${etiquetaMoneda(r.banca.moneda)})`, r.totales.neto, null),
  ];
}

/** Hoja de los movimientos de una cuenta o caja. `filtro` es el texto de búsqueda por N° (si lo hay); las filas de `r` ya vienen filtradas. */
export function hojaReporteCuenta(r: ReporteCuenta, filtro = ''): HojaXlsx {
  const moneda = etiquetaMoneda(r.banca.moneda);
  const conUsd = r.banca.moneda === 'VES';
  const aviso = filtro.trim() ? ` · Filtrado por N°: ${filtro.trim()}` : '';
  const encabezado: Row[] = [
    [celdaTitulo('Movimientos de la cuenta')],
    [celdaTexto(`${r.banca.nombre} · ${moneda}`, true)],
    [celdaTexto(`${textoPeriodo(r.desde, r.hasta)}${aviso} · ${textoGenerado()}`)],
    ...(r.saldoInicial != null && r.saldoFinal != null ? [[celdaTexto(`Saldo inicial: ${moneda} ${formatearNumero(r.saldoInicial, 2)} · Saldo final: ${moneda} ${formatearNumero(r.saldoFinal, 2)}`)]] : []),
    [],
  ];
  return {
    nombre: 'Movimientos',
    filas: [...encabezado, cabeceraCuenta(moneda, conUsd), ...r.filas.map(f => filaCuenta(f, conUsd)), [], ...totalesCuenta(r, conUsd, aviso !== '')],
    anchos: [12, 12, 20, 36, 18, 22, 26, 16, 16, 16, ...(conUsd ? [14] : []), 12],
    filasFijas: encabezado.length + 1,
  };
}

const cabeceraCategorias = (moneda: string): Row => [
  celdaCabecera(`Categoría (${etiquetaMoneda(moneda)})`), celdaCabecera('Subcategoría'),
  celdaCabecera('Ingresos', true), celdaCabecera('Egresos', true), celdaCabecera('Total', true),
];

/** Filas de una moneda: categoría y, debajo, cada una de sus subcategorías con el nombre de su categoría repetido (se puede filtrar en la hoja). */
function filasCategorias(r: ReporteCategorias, moneda: string): Row[] {
  let padre = '';
  return filasPorMoneda(r, moneda).map(f => {
    if (f.nivel === 0) padre = f.nombre;
    const esCategoria = f.nivel === 0;
    return [
      celdaTexto(esCategoria ? f.nombre : padre, esCategoria), celdaTexto(esCategoria ? '' : f.nombre),
      celdaImporte(f.ingresos, esCategoria), celdaImporte(f.egresos, esCategoria), celdaImporte(f.total, esCategoria),
    ];
  });
}

function hojaCategoriasMoneda(r: ReporteCategorias, seleccion: string, moneda: string): HojaXlsx {
  const total = totalGeneral(r, moneda);
  const aviso = textoMovimientosAcceso(r.movimientosExcluidosPorAcceso);
  const encabezado: Row[] = [
    [celdaTitulo('Reporte por categorías')],
    [celdaTexto(seleccion, true)],
    [celdaTexto(`${textoPeriodo(r.desde, r.hasta)} · ${textoGenerado()}`)],
    ...(aviso ? [[celdaTexto(aviso)]] : []),
    [],
  ];
  return {
    nombre: `Categorías ${etiquetaMoneda(moneda)}`,
    filas: [
      ...encabezado, cabeceraCategorias(moneda), ...filasCategorias(r, moneda), [],
      [celdaTexto('Total general', true), null, celdaImporte(total.ingresos, true), celdaImporte(total.egresos, true), celdaImporte(total.total, true)],
    ],
    anchos: [30, 28, 16, 16, 16],
    filasFijas: encabezado.length + 1,
  };
}

/** Una hoja por moneda (no se mezclan). Sin movimientos, una sola hoja con el aviso. */
export function hojasReporteCategorias(r: ReporteCategorias, seleccion: string): HojaXlsx[] {
  const monedas = monedasDelReporte(r);
  if (monedas.length > 0) return monedas.map(m => hojaCategoriasMoneda(r, seleccion, m));
  return [{
    nombre: 'Categorías',
    filas: [
      [celdaTitulo('Reporte por categorías')], [celdaTexto(seleccion, true)], [celdaTexto(`${textoPeriodo(r.desde, r.hasta)} · ${textoGenerado()}`)], [],
      [celdaTexto('No hay movimientos con estos filtros en el periodo.')],
    ],
    anchos: [60],
  }];
}

export const nombreXlsxReporteCuenta = (r: ReporteCuenta): string => nombreArchivoXlsx(['Reporte', r.banca.nombre, `${r.desde}-a-${r.hasta}`]);
export const nombreXlsxReporteCategorias = (r: ReporteCategorias): string => nombreArchivoXlsx(['Reporte-categorias', `${r.desde}-a-${r.hasta}`]);

export const descargarReporteCuentaXlsx = (r: ReporteCuenta, filtro = ''): Promise<void> => descargarXlsx(nombreXlsxReporteCuenta(r), [hojaReporteCuenta(r, filtro)]);

export const descargarReporteCategoriasXlsx = (r: ReporteCategorias, seleccion: string): Promise<void> =>
  descargarXlsx(nombreXlsxReporteCategorias(r), hojasReporteCategorias(r, seleccion));
