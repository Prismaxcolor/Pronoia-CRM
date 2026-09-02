import { consolidarItems, type FacturaCV } from './factura-cv-service';
import { type TicketPesaje } from '@shared/types/index.js';
import {
  fmt, sanitizarPdf, descargarBlob,
  encabezadoMarca, tituloConBadge, filaEncabezado, tablaMonetaria, tablaPesaje,
} from './pdf-documento';

// jspdf y docx se cargan bajo demanda (dynamic import) para no inflar el bundle
// inicial: solo pesan cuando el usuario descarga una factura.

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
