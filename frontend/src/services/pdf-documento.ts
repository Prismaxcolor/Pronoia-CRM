import { PRONOIA_LOGO_ICON_PNG_BASE64 } from '../assets/pronoia-logo-icon';

/**
 * Motor de diseño compartido para todos los PDF que genera el sistema —
 * factura, ticket de pesaje, toma física, nota de crédito/débito,
 * comprobante de pago/cobro. Un solo lugar para el encabezado de marca, el
 * patrón de filas etiqueta-valor, y las dos familias de tabla (monetaria
 * cuadrada / pesaje redondeada). Ver factura-export.ts para el caso de uso
 * más completo (documento mixto: monetario + pesaje en el mismo PDF).
 */

export function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * jsPDF con la fuente helvetica estándar solo soporta cp1252 (WinAnsi). Los
 * caracteres tipográficos de Word/Google Docs que caen fuera rompen el
 * renderizado de la línea completa (confirmado con U+2212 el 2026-07-23). Se
 * mapean a su equivalente ASCII antes de escribir.
 */
const REEMPLAZOS_PDF: Array<[RegExp, string]> = [
  [/[−–—]/g, '-'], // menos matemático, en dash, em dash
  [/[‘’‛]/g, "'"],
  [/[“”‟]/g, '"'],
  [/…/g, '...'],
  [/ /g, ' '],
];

export function sanitizarPdf(v: string): string {
  return REEMPLAZOS_PDF.reduce((s, [re, r]) => s.replace(re, r), v);
}

export function descargarBlob(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const BOX_LEFT = 56;
export const BOX_RIGHT = 539;
export const BOX_PAD = 16;
const GRIS_BORDE_CAJA: [number, number, number] = [205, 205, 205];
const GRIS_LINEA_HEAD: [number, number, number] = [190, 190, 190];
const GRIS_LINEA_FILA: [number, number, number] = [232, 232, 232];
const GRIS_DIVISOR: [number, number, number] = [215, 215, 215];
const GRIS_GRID: [number, number, number] = [70, 70, 70];

/** Color del texto/borde del badge de estado — mismo criterio de color que
 *  usan las pantallas de detalle (gris/azul/verde/ámbar/naranja/morado/rojo). */
const BADGE_COLOR: Record<string, [number, number, number]> = {
  borrador: [90, 95, 105],
  emitida: [29, 78, 175],
  pagada: [21, 128, 61],
  cobrada: [21, 128, 61],
  abierta: [161, 98, 7],
  cerrada: [21, 128, 61],
  credito: [29, 78, 175],
  crédito: [29, 78, 175],
  débito: [109, 40, 178],
  debito: [109, 40, 178],
  anulada: [185, 28, 28],
  facturado: [21, 128, 61],
  'pendiente por facturar': [161, 98, 7],
};

/**
 * Encabezado de marca — ícono + "Pronoia" arriba a la derecha. Estándar en
 * TODOS los documentos que emite el sistema.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function encabezadoMarca(doc: any): void {
  const y = 56;
  const iconSize = 22;
  const iconX = BOX_RIGHT - iconSize;
  doc.addImage(PRONOIA_LOGO_ICON_PNG_BASE64, 'PNG', iconX, y - 16, iconSize, iconSize * (164 / 160));
  doc.setFontSize(16).setFont('helvetica', 'bold').setTextColor(20, 30, 40).text('Pronoia', iconX - 8, y, { align: 'right' });
  doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(130).text('Sistema de compras', iconX - 8, y + 14, { align: 'right' });
  doc.setTextColor(0);
}

/** Título del documento + badge de estado (siempre en píldora redonda, sea
 *  cual sea el tipo de documento — el redondeado del badge es constante). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tituloConBadge(doc: any, y: number, titulo: string, badgeTexto?: string | null): void {
  doc.setFontSize(18).setFont('helvetica', 'bold').setTextColor(0).text(titulo, BOX_LEFT, y);
  if (badgeTexto) {
    const color = BADGE_COLOR[badgeTexto.toLowerCase()] ?? [90, 95, 105];
    const anchoTitulo = doc.getTextWidth(titulo);
    const bx = BOX_LEFT + anchoTitulo + 12;
    doc.setFontSize(9).setFont('helvetica', 'bold');
    const bw = doc.getTextWidth(badgeTexto.toUpperCase()) + 18;
    doc.setDrawColor(...color).setLineWidth(1).roundedRect(bx, y - 13, bw, 18, 9, 9, 'S');
    doc.setTextColor(...color).text(badgeTexto.toUpperCase(), bx + bw / 2, y - 1, { align: 'center' });
  }
  doc.setTextColor(0);
}

/**
 * Fila etiqueta/valor con línea divisoria completa debajo — el patrón
 * estándar de encabezado en TODOS los documentos (factura, ticket, nota,
 * pago, toma física...). Devuelve el Y donde continúa el documento.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function filaEncabezado(doc: any, y: number, label: string, valor: string): number {
  doc.setFontSize(11).setFont('helvetica', 'normal').setTextColor(90);
  doc.text(sanitizarPdf(label), BOX_LEFT, y);
  doc.setTextColor(15);
  const lineas = doc.splitTextToSize(sanitizarPdf(valor), 320);
  doc.text(lineas, BOX_RIGHT, y, { align: 'right' });
  const yLinea = y + 8 + (lineas.length - 1) * 13;
  doc.setDrawColor(...GRIS_DIVISOR).setLineWidth(0.75).line(BOX_LEFT, yLinea, BOX_RIGHT, yLinea);
  doc.setTextColor(0);
  return yLinea + 20;
}

/**
 * Tabla MONETARIA (montos, dinero): grid completo, esquinas cuadradas — como
 * una hoja de cálculo. Para ítems de factura, notas de crédito/débito, pagos.
 */
export function tablaMonetaria(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  autoTable: any,
  opts: { startY: number; head: string[][]; body: string[][]; foot?: string[][] }
): number {
  autoTable(doc, {
    startY: opts.startY,
    head: opts.head,
    body: opts.body,
    foot: opts.foot,
    margin: { left: BOX_LEFT, right: 595.28 - BOX_RIGHT },
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 7, lineWidth: 0.75, lineColor: GRIS_GRID },
    headStyles: { fillColor: [245, 245, 245], textColor: 0, fontStyle: 'bold', lineWidth: 0.75, lineColor: GRIS_GRID },
    footStyles: { fillColor: [245, 245, 245], textColor: 0, fontStyle: 'bold', lineWidth: 0.75, lineColor: GRIS_GRID },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    theme: 'grid',
  });
  return doc.lastAutoTable.finalY;
}

/**
 * Tabla de PESAJE (kilos, materiales): caja de esquinas redondeadas. El
 * tamaño de la caja se mide DESPUÉS de renderizar la tabla (nunca se estima)
 * — así calza siempre con el contenido real sin importar cuántas filas
 * ocupe. El contenido va separado del borde por BOX_PAD para que el texto
 * nunca toque la curva, y todas las líneas internas usan el mismo tono de
 * gris (nunca negro puro) para no chocar visualmente con el borde
 * redondeado. Devuelve el Y donde continúa el documento.
 */
export function tablaPesaje(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  autoTable: any,
  opts: { startY: number; head: string[][]; body: string[][]; foot?: string[][] }
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = { left: BOX_LEFT + BOX_PAD, right: pageWidth - (BOX_RIGHT - BOX_PAD) };
  autoTable(doc, {
    startY: opts.startY + 10,
    head: opts.head,
    body: opts.body,
    foot: opts.foot,
    margin,
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 7, lineWidth: { bottom: 0.5 }, lineColor: GRIS_LINEA_FILA },
    headStyles: { fillColor: false, textColor: 0, fontStyle: 'bold', lineWidth: { bottom: 1 }, lineColor: GRIS_LINEA_HEAD },
    footStyles: { fillColor: false, textColor: 0, fontStyle: 'bold', lineWidth: { top: 1 }, lineColor: GRIS_LINEA_HEAD },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    theme: 'plain',
  });
  const finalY = doc.lastAutoTable.finalY;
  const rectHeight = finalY - opts.startY + 10;
  doc.setDrawColor(...GRIS_BORDE_CAJA).setLineWidth(1)
    .roundedRect(BOX_LEFT, opts.startY, BOX_RIGHT - BOX_LEFT, rectHeight, 8, 8, 'S');
  return finalY + 10;
}
