import { consolidarItems, type FacturaCV } from './factura-cv-service';

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

/** Texto del origen del peso: peso manual o cantidad de tickets (sin fetch
 *  extra — mismo fallback que usa FacturaDetallePage cuando no hay tickets
 *  cargados). */
function origenPeso(f: FacturaCV): string {
  if (f.ticketIds.length === 0) return 'Peso manual';
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

export async function descargarFacturaPDF(f: FacturaCV): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const esCompra = f.tipo === 'compra';
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  let y = 56;
  doc.setFontSize(20).setFont('helvetica', 'bold').text('Pronoia', 56, y);
  doc.setFontSize(10).setFont('helvetica', 'normal').setTextColor(130).text('Sistema de compras', 56, y + 15);
  doc.setTextColor(0);

  y += 52;
  doc.setFontSize(15).setFont('helvetica', 'bold').text(`Factura de ${esCompra ? 'compra' : 'venta'}`, 56, y);

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
    const lineas = doc.splitTextToSize(sanitizarPdf(v), 289); // 539 - 250
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
