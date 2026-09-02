import { consolidarItems, type FacturaCV } from './factura-cv-service';
import { type TicketPesaje } from '@shared/types/index.js';
import { PRONOIA_LOGO_ICON_PNG_BASE64 } from '../assets/pronoia-logo-icon';

// jspdf y docx se cargan bajo demanda (dynamic import) para no inflar el bundle
// inicial: solo pesan cuando el usuario descarga una factura.

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * jsPDF con la fuente helvetica estándar solo soporta cp1252 (WinAnsi). Los
 * caracteres tipográficos de Word/Google Docs que caen fuera rompen el
 * renderizado de la línea completa (confirmado con U+2212 el 2026-07-23). Se
 * mapean a su equivalente ASCII antes de escribir.
 */
const REEMPLAZOS_PDF: Array<[RegExp, string]> = [
  [/[\u2212\u2013\u2014]/g, '-'], // menos matemático, en dash, em dash
  [/[\u2018\u2019\u201B]/g, "'"],
  [/[\u201C\u201D\u201F]/g, '"'],
  [/\u2026/g, '...'],
  [/\u00A0/g, ' '],
];

function sanitizarPdf(v: string): string {
  return REEMPLAZOS_PDF.reduce((s, [re, r]) => s.replace(re, r), v);
}

/** Referencia visible de la factura: correlativo ("C-0001"/"V-0001") o, si no
 *  lo tiene, los primeros dígitos del id. */
function refFactura(f: FacturaCV): string {
  return f.codigo ?? `N.º ${f.id.slice(0, 8)}`;
}

/** Texto del origen del peso: códigos reales de los tickets si están
 *  cargados (mismo criterio que FacturaDetallePage), o un conteo genérico si
 *  no se pasaron. */
function origenPeso(f: FacturaCV, tickets: TicketPesaje[]): string {
  if (f.ticketIds.length === 0) return 'Peso manual';
  if (tickets.length > 0) return `${tickets.length} ticket${tickets.length === 1 ? '' : 's'} · ${tickets.map(t => t.codigo).join(', ')}`;
  return `${f.ticketIds.length} ticket${f.ticketIds.length === 1 ? '' : 's'} de pesaje`;
}

function nombreArchivo(f: FacturaCV, ext: string): string {
  const ref = (f.codigo ?? f.id.slice(0, 8)).replace(/\s+/g, '-').toLowerCase();
  return `factura-${f.tipo}-${ref}.${ext}`;
}

/** Filas (etiqueta, valor) de la cabecera de la factura (sin las líneas). */
function filasFactura(f: FacturaCV): Array<[string, string]> {
  const esCompra = f.tipo === 'compra';
  const filas: Array<[string, string]> = [
    [esCompra ? 'Proveedor' : 'Cliente', f.nombreEntidad ?? '—'],
  ];
  if (f.descripcion) filas.push(['Descripción', f.descripcion]);
  if (f.observaciones) filas.push(['Observaciones', f.observaciones]);
  return filas;
}

/** Una línea de la factura como texto: "Material · 12,00 kg × 3,00 = 36,00" (Word). */
function lineaTexto(it: FacturaCV['items'][number]): string {
  return `${it.nombreProducto ?? 'material'} · ${fmt(it.peso)} kg × ${fmt(it.precioUnitario)} = ${fmt(it.subtotal)}`;
}

const BOX_LEFT = 56;
const BOX_RIGHT = 539;
const BOX_PAD = 16;
const GRIS_BORDE_CAJA: [number, number, number] = [205, 205, 205];
const GRIS_LINEA_HEAD: [number, number, number] = [190, 190, 190];
const GRIS_LINEA_FILA: [number, number, number] = [232, 232, 232];
const GRIS_DIVISOR: [number, number, number] = [215, 215, 215];
const GRIS_GRID: [number, number, number] = [70, 70, 70];

/** Color del texto/borde del badge de estado — mismo criterio de color que
 *  ESTADO_CFG en FacturaDetallePage.tsx (gris/azul/verde). */
const BADGE_COLOR: Record<string, [number, number, number]> = {
  borrador: [90, 95, 105],
  emitida: [29, 78, 175],
  pagada: [21, 128, 61],
};

/**
 * Encabezado de marca — ícono + "Pronoia" arriba a la derecha. Estándar en
 * TODOS los documentos que emite el sistema.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function encabezadoMarca(doc: any): void {
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
function tituloConBadge(doc: any, y: number, titulo: string, badgeTexto?: string | null): void {
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
function filaEncabezado(doc: any, y: number, label: string, valor: string): number {
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tablaMonetaria(doc: any, autoTable: any, opts: { startY: number; head: string[][]; body: string[][]; foot?: string[][] }): number {
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tablaPesaje(doc: any, autoTable: any, opts: { startY: number; head: string[][]; body: string[][]; foot?: string[][] }): number {
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

function descargarBlob(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function descargarFacturaPDF(f: FacturaCV, tickets: TicketPesaje[] = []): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const esCompra = f.tipo === 'compra';
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  encabezadoMarca(doc);

  let y = 56 + 52;
  tituloConBadge(doc, y, `Factura de ${esCompra ? 'compra' : 'venta'}`, f.estado);

  y += 22;
  y = filaEncabezado(doc, y, 'Ref.', `${refFactura(f)}  ·  ${f.createdAt.slice(0, 10)}`);
  y = filaEncabezado(doc, y, esCompra ? 'Proveedor' : 'Cliente', f.nombreEntidad ?? '—');
  y = filaEncabezado(doc, y, 'Origen del peso', origenPeso(f, tickets));
  for (const [k, v] of filasFactura(f).slice(1)) {
    y = filaEncabezado(doc, y, k, v);
  }

  y += 6;
  const itemsBody = consolidarItems(f.items).map(it => [
    sanitizarPdf(it.nombreProducto ?? '—'),
    fmt(it.peso),
    fmt(it.precioUnitario),
    fmt(it.subtotal),
  ]);
  y = tablaMonetaria(doc, autoTable, {
    startY: y,
    head: [['Ítem', 'Cantidad (kg)', 'Precio unitario', 'Monto total']],
    body: itemsBody,
  });

  y += 30;
  doc.setFontSize(20).setFont('helvetica', 'bold').text('Total', 56, y);
  doc.text(fmt(f.total), 539, y, { align: 'right' });

  if (esCompra && f.montoPagado > 0) {
    y += 20;
    doc.setFontSize(10).setFont('helvetica', 'normal');
    doc.text('Pagado', 56, y);
    doc.text(fmt(f.montoPagado), 539, y, { align: 'right' });
    y += 16;
    doc.text('Saldo pendiente', 56, y);
    doc.text(fmt(Math.max(f.total - f.montoPagado, 0)), 539, y, { align: 'right' });
  }

  const totalPeso = consolidarItems(f.items).reduce((acc, it) => acc + it.peso, 0);
  y += 26;
  doc.setDrawColor(120).setLineWidth(1.5).line(56, y, 539, y);
  y += 24;
  doc.setFontSize(15).setFont('helvetica', 'bold').text('Total de kilos facturados', 56, y);
  doc.text(`${fmt(totalPeso)} kg`, 539, y, { align: 'right' });

  const pageHeight = doc.internal.pageSize.getHeight();
  for (const ticket of tickets) {
    y += 34;
    if (y > pageHeight - 120) { doc.addPage(); y = 56; }
    doc.setFontSize(15).setFont('helvetica', 'bold').setTextColor(0);
    doc.text(sanitizarPdf(`Ticket de pesaje - ${ticket.codigo}`), 56, y);
    y += 14;
    const totalDevolucion = ticket.materiales.reduce((acc, m) => acc + (m.devolucion || 0), 0);
    const footRows = totalDevolucion > 0
      ? [
          ['Total del ticket', '', '', `${fmt(ticket.pesoNetoTotal)} kg`],
          ['Devolución', '', '', `${fmt(totalDevolucion)} kg`],
        ]
      : [['Total del ticket', '', '', `${fmt(ticket.pesoNetoTotal)} kg`]];
    const materialesBody = ticket.materiales.map(m => [
      sanitizarPdf(m.nombreProducto ?? '-'),
      fmt(m.pesoBruto),
      fmt(m.tara),
      fmt(m.pesoNeto),
    ]);
    y = tablaPesaje(doc, autoTable, {
      startY: y,
      head: [['Material', 'Bruto', 'Tara', 'Neto (kg)']],
      body: materialesBody,
      foot: footRows,
    });
  }

  doc.save(nombreArchivo(f, 'pdf'));
}

export async function descargarFacturaWord(f: FacturaCV): Promise<void> {
  const { Document, Packer, Paragraph, TextRun } = await import('docx');
  const esCompra = f.tipo === 'compra';
  const vacio = () => new Paragraph({ text: '' });
  const fila = (k: string, v: string) =>
    new Paragraph({ children: [new TextRun({ text: `${k}: `, bold: true }), new TextRun(v)] });

  const children = [
    new Paragraph({ children: [new TextRun({ text: 'Pronoia', bold: true, size: 36 })] }),
    new Paragraph({ children: [new TextRun({ text: 'Sistema de compras', italics: true, color: '888888' })] }),
    vacio(),
    new Paragraph({ children: [new TextRun({ text: `Factura de ${esCompra ? 'compra' : 'venta'}`, bold: true, size: 28 })] }),
    fila('N.º', f.codigo ?? f.id.slice(0, 8)),
    fila('Fecha', f.createdAt.slice(0, 10)),
    fila('Estado', f.estado),
    vacio(),
    ...filasFactura(f).map(([k, v]) => fila(k, v)),
    vacio(),
    new Paragraph({ children: [new TextRun({ text: 'Líneas', bold: true })] }),
    ...consolidarItems(f.items).map(it => new Paragraph({ text: `• ${lineaTexto(it)}` })),
    vacio(),
    new Paragraph({ children: [new TextRun({ text: `Total: ${fmt(f.total)}`, bold: true, size: 28 })] }),
  ];

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  descargarBlob(blob, nombreArchivo(f, 'docx'));
}
