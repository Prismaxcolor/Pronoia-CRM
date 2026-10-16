import type { ReporteCategorias, ReporteCuenta } from '@shared/types/index.js';
import { formatearFecha } from '../../../lib/formato';
import {
  BOX_LEFT, BOX_RIGHT, encabezadoMarca, entregarPdf, fmt, sanitizarPdf, subtitulo, tituloConBadge,
  type ArchivoPdf, type ModoPdf,
} from '../../../services/pdf-documento';
import { numeroMovimiento } from '../detalle-movimiento';
import {
  etiquetaMoneda, filasPorMoneda, monedasDelReporte, nombreArchivoReporte, textoMovimientosAcceso, textoTipoFila, totalGeneral,
} from './reporte-wallet-datos';
import { esHexValido } from './categorias-logica';

/* eslint-disable @typescript-eslint/no-explicit-any */

const MARGEN_PAGINA_DER = 595.28 - BOX_RIGHT;
const GRIS_LINEA: [number, number, number] = [200, 200, 200];
const GRIS_FONDO: [number, number, number] = [245, 245, 245];
const ESTILOS_TABLA = {
  font: 'helvetica', fontSize: 8, cellPadding: 4, lineWidth: 0.5, lineColor: GRIS_LINEA, textColor: 20,
};
const RADIO_PUNTO = 3;
const SANGRIA_PUNTO = 12;
const SANGRIA_SUB = 22;

function hexARgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** Punto de color a la izquierda de una celda (el nombre siempre va escrito al lado). */
function dibujarPunto(doc: any, celda: any, hex: string | null | undefined): void {
  if (!hex || !esHexValido(hex)) return;
  doc.setFillColor(...hexARgb(hex)).circle(celda.x + 6, celda.y + celda.height / 2, RADIO_PUNTO, 'F');
}

function pieDeFecha(doc: any): void {
  const paginas: number = doc.getNumberOfPages();
  const alto: number = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    doc.setFontSize(8).setFont('helvetica', 'normal').setTextColor(110);
    doc.text(sanitizarPdf(`Generado el ${formatearFecha(new Date())} · Página ${i} de ${paginas}`), BOX_RIGHT, alto - 28, { align: 'right' });
  }
  doc.setTextColor(0);
}

async function nuevoDocumento(): Promise<{ doc: any; autoTable: any }> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  return { doc: new jsPDF({ unit: 'pt', format: 'a4' }), autoTable };
}

function encabezado(doc: any, titulo: string, lineas: readonly string[]): number {
  encabezadoMarca(doc);
  let y = 56 + 30;
  tituloConBadge(doc, y, titulo, null);
  for (const l of lineas) { y += 16; subtitulo(doc, y, l); }
  return y + 18;
}

/** Reporte imprimible de los movimientos de una cuenta o caja en un rango de fechas (con categoría, entradas, salidas y neto). */
export async function descargarReporteCuentaPDF(r: ReporteCuenta, modo: ModoPdf = 'descargar'): Promise<ArchivoPdf | undefined> {
  const { doc, autoTable } = await nuevoDocumento();
  const moneda = etiquetaMoneda(r.banca.moneda);
  const y = encabezado(doc, 'Movimientos de la cuenta', [`${r.banca.nombre} · ${moneda}`, `Del ${formatearFecha(r.desde)} al ${formatearFecha(r.hasta)}`]);
  const cuerpo = r.filas.map(f => [
    formatearFecha(f.fecha),
    numeroMovimiento(f),
    textoTipoFila(f) + (f.anulado ? ' (anulado)' : f.enProceso ? ' (en proceso)' : ''),
    [f.descripcion, f.cuentaContraria ? `Con: ${f.cuentaContraria}` : ''].filter(Boolean).join(' · ') || '-',
    f.categoria?.nombre ?? 'Sin categoría',
    f.entrada ? fmt(f.entrada) : '',
    f.salida ? fmt(f.salida) : '',
  ].map(sanitizarPdf));
  const { entradas, salidas, neto } = r.totales;
  autoTable(doc, {
    startY: y,
    margin: { left: BOX_LEFT, right: MARGEN_PAGINA_DER, bottom: 44 },
    head: [['Fecha', 'N°', 'Tipo', 'Descripción', 'Categoría', `Entra (${moneda})`, `Sale (${moneda})`]],
    body: cuerpo,
    foot: [
      [{ content: 'Total que entra', colSpan: 5, styles: { halign: 'right' } }, fmt(entradas), ''],
      [{ content: 'Total que sale', colSpan: 5, styles: { halign: 'right' } }, '', fmt(salidas)],
      [{ content: 'Neto del periodo', colSpan: 5, styles: { halign: 'right' } }, { content: fmt(neto), colSpan: 2, styles: { halign: 'right' } }],
    ],
    showFoot: 'lastPage',
    theme: 'grid',
    styles: ESTILOS_TABLA,
    headStyles: { fillColor: GRIS_FONDO, textColor: 0, fontStyle: 'bold' },
    footStyles: { fillColor: GRIS_FONDO, textColor: 0, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 46 }, 1: { cellWidth: 46 }, 2: { cellWidth: 62 }, 4: { cellWidth: 82 }, 5: { halign: 'right', cellWidth: 52 }, 6: { halign: 'right', cellWidth: 52 } },
    didParseCell: (d: any) => {
      if (d.section === 'body' && d.column.index === 4 && r.filas[d.row.index]?.categoria) d.cell.styles.cellPadding = { top: 4, bottom: 4, left: SANGRIA_PUNTO, right: 4 };
      if (d.section === 'body' && r.filas[d.row.index]?.anulado) d.cell.styles.textColor = 130;
    },
    didDrawCell: (d: any) => {
      if (d.section === 'body' && d.column.index === 4) dibujarPunto(doc, d.cell, r.filas[d.row.index]?.categoria?.color);
    },
  });
  pieDeFecha(doc);
  return entregarPdf(doc, nombreArchivoReporte('Movimientos', r.banca.nombre, r.desde, r.hasta), modo);
}

function tablaDeMoneda(doc: any, autoTable: any, r: ReporteCategorias, moneda: string, y: number): number {
  const filas = filasPorMoneda(r, moneda);
  const total = totalGeneral(r, moneda);
  autoTable(doc, {
    startY: y,
    margin: { left: BOX_LEFT, right: MARGEN_PAGINA_DER, bottom: 44 },
    head: [[`Categoría (${etiquetaMoneda(moneda)})`, 'Ingresos', 'Egresos', 'Total']],
    body: filas.map(f => [sanitizarPdf(f.nombre), fmt(f.ingresos), fmt(f.egresos), fmt(f.total)]),
    foot: [['Total general', fmt(total.ingresos), fmt(total.egresos), fmt(total.total)]],
    showFoot: 'lastPage',
    theme: 'grid',
    styles: { ...ESTILOS_TABLA, fontSize: 9 },
    headStyles: { fillColor: GRIS_FONDO, textColor: 0, fontStyle: 'bold' },
    footStyles: { fillColor: GRIS_FONDO, textColor: 0, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right', cellWidth: 90 }, 2: { halign: 'right', cellWidth: 90 }, 3: { halign: 'right', cellWidth: 90 } },
    didParseCell: (d: any) => {
      const fila = filas[d.row.index];
      if (d.section !== 'body' || !fila) return;
      if (d.column.index === 0) d.cell.styles.cellPadding = { top: 4, bottom: 4, left: fila.nivel === 0 ? SANGRIA_PUNTO : SANGRIA_SUB, right: 4 };
      if (fila.nivel === 0) d.cell.styles.fontStyle = 'bold';
    },
    didDrawCell: (d: any) => {
      const fila = filas[d.row.index];
      if (d.section === 'body' && d.column.index === 0 && fila) dibujarPunto(doc, { ...d.cell, x: d.cell.x + (fila.nivel === 0 ? 0 : 10) }, fila.color);
    },
  });
  return (doc.lastAutoTable.finalY as number) + 22;
}

/** Reporte imprimible por categorías: ingresos, egresos y total por categoría y subcategoría; una tabla por moneda (no se mezclan). */
export async function descargarReporteCategoriasPDF(
  r: ReporteCategorias,
  seleccion: string,
  modo: ModoPdf = 'descargar',
): Promise<ArchivoPdf | undefined> {
  const { doc, autoTable } = await nuevoDocumento();
  const aviso = textoMovimientosAcceso(r.movimientosExcluidosPorAcceso);
  const lineas = [seleccion, `Del ${formatearFecha(r.desde)} al ${formatearFecha(r.hasta)}`, ...(aviso ? [aviso] : [])];
  let y = encabezado(doc, 'Reporte por categorías', lineas);
  const monedas = monedasDelReporte(r);
  if (monedas.length === 0) {
    doc.setFontSize(11).setTextColor(90).text('No hay movimientos con estos filtros en el periodo.', BOX_LEFT, y);
  }
  for (const moneda of monedas) y = tablaDeMoneda(doc, autoTable, r, moneda, y);
  pieDeFecha(doc);
  return entregarPdf(doc, nombreArchivoReporte('Reporte-categorias', null, r.desde, r.hasta), modo);
}
