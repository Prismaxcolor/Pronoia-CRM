import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { FacturaPublica, ItemPublico } from './factura-service.js';
import type { TicketPublico, MaterialPublico } from './ticket-pesaje-service.js';

// Réplica server-side de frontend/src/services/factura-export.ts (descargarFacturaPDF):
// mismo armado de documento, solo cambia la salida final (arraybuffer en vez de
// doc.save() en el navegador) para que el PDF que se manda por Telegram sea igual al
// que se ve/descarga en la web — un solo diseño de verdad.

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
  [/[\u2212\u2013\u2014]/g, '-'],
  [/[\u2018\u2019\u201B]/g, "'"],
  [/[\u201C\u201D\u201F]/g, '"'],
  [/\u2026/g, '...'],
  [/\u00A0/g, ' '],
];

function sanitizarPdf(v: string): string {
  return REEMPLAZOS_PDF.reduce((s, [re, r]) => s.replace(re, r), v);
}

/** Texto del origen del peso: peso manual o cantidad de tickets. */
function origenPeso(f: FacturaPublica): string {
  if (f.ticketIds.length === 0) return 'Peso manual';
  return `${f.ticketIds.length} ticket${f.ticketIds.length === 1 ? '' : 's'} de pesaje`;
}

function refFactura(f: FacturaPublica): string {
  return f.codigo ?? `N.º ${f.id.slice(0, 8)}`;
}

export function nombreArchivoFactura(f: FacturaPublica): string {
  const ref = (f.codigo ?? f.id.slice(0, 8)).replace(/\s+/g, '-').toLowerCase();
  return `factura-${f.tipo}-${ref}.pdf`;
}

export function nombreArchivoTicket(t: TicketPublico): string {
  const ref = t.codigo.replace(/\s+/g, '-').toLowerCase();
  return `ticket-${ref}.pdf`;
}

function filasFactura(f: FacturaPublica): Array<[string, string]> {
  const esCompra = f.tipo === 'compra';
  const filas: Array<[string, string]> = [
    [esCompra ? 'Proveedor' : 'Cliente', f.nombreEntidad ?? '—'],
  ];
  if (f.descripcion) filas.push(['Descripción', f.descripcion]);
  if (f.observaciones) filas.push(['Observaciones', f.observaciones]);
  return filas;
}

/** Idéntico a consolidarItems de factura-cv-service.ts (agrupa por producto). */
function consolidarItems(items: ItemPublico[]): ItemPublico[] {
  const mapa = new Map<string, ItemPublico>();
  for (const it of items) {
    const clave = it.productoId ?? `nombre:${it.nombreProducto ?? ''}`;
    const ex = mapa.get(clave);
    if (ex) {
      ex.peso += it.peso;
      ex.subtotal += it.subtotal;
      ex.precioUnitario = ex.peso > 0 ? ex.subtotal / ex.peso : ex.precioUnitario;
    } else {
      mapa.set(clave, { ...it });
    }
  }
  return Array.from(mapa.values());
}

function encabezado(doc: jsPDF, titulo: string): number {
  let y = 56;
  doc.setFontSize(20).setFont('helvetica', 'bold').text('Pronoia', 56, y);
  doc.setFontSize(10).setFont('helvetica', 'normal').setTextColor(130).text('Sistema de compras', 56, y + 15);
  doc.setTextColor(0);

  y += 52;
  doc.setFontSize(15).setFont('helvetica', 'bold').text(titulo, 56, y);
  return y;
}

export function generarFacturaPdf(f: FacturaPublica): Buffer {
  const esCompra = f.tipo === 'compra';
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  let y = encabezado(doc, `Factura de ${esCompra ? 'compra' : 'venta'}`);

  y += 20;
  doc.setFontSize(10).setFont('helvetica', 'normal');
  doc.text(refFactura(f), 56, y);
  doc.text(`Fecha: ${f.createdAt.slice(0, 10)}`, 250, y);
  doc.text(`Estado: ${f.estado}`, 420, y);

  y += 30;
  doc.setFontSize(11);
  const filas: Array<[string, string]> = [
    [esCompra ? 'Proveedor' : 'Cliente', f.nombreEntidad ?? '—'],
    ['Origen del peso', origenPeso(f)],
    ...filasFactura(f).slice(1),
  ];
  for (const [k, v] of filas) {
    const lineas = doc.splitTextToSize(sanitizarPdf(v), 289);
    doc.setFont('helvetica', 'bold').text(k, 56, y);
    doc.setFont('helvetica', 'normal').text(lineas, 250, y);
    y += 20 + (lineas.length - 1) * 13;
  }

  y += 10;
  autoTable(doc, {
    startY: y,
    head: [['Ítem', 'Cantidad (kg)', 'Precio unitario', 'Monto total']],
    body: consolidarItems(f.items).map(it => [
      sanitizarPdf(it.nombreProducto ?? '—'),
      fmt(it.peso),
      fmt(it.precioUnitario),
      fmt(it.subtotal),
    ]),
    margin: { left: 56, right: 56 },
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: false, textColor: 0, lineWidth: 0.5, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    theme: 'grid',
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY;

  y += 26;
  doc.setFontSize(14).setFont('helvetica', 'bold').text('Total', 56, y);
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
  doc.setDrawColor(0).setLineWidth(1).line(56, y, 539, y);
  y += 20;
  doc.setFontSize(12).setFont('helvetica', 'bold').text('Total de kilos facturados', 56, y);
  doc.text(`${fmt(totalPeso)} kg`, 539, y, { align: 'right' });

  return Buffer.from(doc.output('arraybuffer'));
}

function destinoLabelPdf(m: MaterialPublico): string {
  return m.destinoTipo === 'lote' ? (m.nombreLote ?? 'Lote') : 'MPP';
}

/** Ticket de pesaje: mismo estilo visual que la factura, sin precios (el ticket
 *  nunca lleva el monto a pagar — esa es justamente la diferencia con la factura). */
export function generarTicketPdf(t: TicketPublico, nombreEntidad: string): Buffer {
  const esCompra = t.tipo === 'compra';
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  let y = encabezado(doc, `Ticket de pesaje (${esCompra ? 'compra' : 'venta'})`);

  y += 20;
  doc.setFontSize(10).setFont('helvetica', 'normal');
  doc.text(t.codigo, 56, y);
  doc.text(`Fecha: ${(t.fecha ?? t.createdAt).slice(0, 10)}`, 250, y);
  doc.text(`Estado: ${t.estado}`, 420, y);

  y += 30;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold').text(esCompra ? 'Proveedor' : 'Cliente', 56, y);
  doc.setFont('helvetica', 'normal').text(sanitizarPdf(nombreEntidad), 250, y);
  y += 20;
  if (t.observaciones) {
    const lineas = doc.splitTextToSize(sanitizarPdf(t.observaciones), 289);
    doc.setFont('helvetica', 'bold').text('Observaciones', 56, y);
    doc.setFont('helvetica', 'normal').text(lineas, 250, y);
    y += 20 + (lineas.length - 1) * 13;
  }

  y += 10;
  autoTable(doc, {
    startY: y,
    head: [['Material', 'Destino', 'Bruto', 'Tara', 'Devol.', 'Neto (kg)']],
    body: t.materiales.map(m => [
      sanitizarPdf(m.nombreProducto ?? m.subcategoria ?? '—'),
      sanitizarPdf(destinoLabelPdf(m)),
      fmt(m.pesoBruto),
      fmt(m.tara),
      fmt(m.devolucion),
      fmt(m.pesoNeto),
    ]),
    margin: { left: 56, right: 56 },
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: false, textColor: 0, lineWidth: 0.5, fontStyle: 'bold' },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    theme: 'grid',
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY;

  y += 26;
  doc.setFontSize(14).setFont('helvetica', 'bold').text('Peso neto total', 56, y);
  doc.text(`${fmt(t.pesoNetoTotal)} kg`, 539, y, { align: 'right' });

  return Buffer.from(doc.output('arraybuffer'));
}
