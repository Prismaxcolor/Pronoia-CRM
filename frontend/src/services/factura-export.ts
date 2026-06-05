import type { FacturaCV } from './factura-cv-service';

// jspdf y docx se cargan bajo demanda (dynamic import) para no inflar el bundle
// inicial: solo pesan cuando el usuario descarga una factura.

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function nombreArchivo(f: FacturaCV, ext: string): string {
  return `factura-${f.tipo}-${f.id.slice(0, 8)}.${ext}`;
}

/** Filas (etiqueta, valor) que componen el cuerpo de la factura. */
function filasFactura(f: FacturaCV): Array<[string, string]> {
  const esCompra = f.tipo === 'compra';
  const filas: Array<[string, string]> = [
    [esCompra ? 'Proveedor' : 'Cliente', f.nombreEntidad ?? '—'],
    ['Material', f.nombreProducto ?? '—'],
    ['Peso facturado', `${fmt(f.peso)} kg`],
    ['Precio unitario (kg)', fmt(f.precioUnitario)],
  ];
  if (f.descripcion) filas.push(['Descripción', f.descripcion]);
  if (f.observaciones) filas.push(['Observaciones', f.observaciones]);
  return filas;
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
  doc.text(`N.º ${f.id.slice(0, 8)}`, 56, y);
  doc.text(`Fecha: ${f.createdAt.slice(0, 10)}`, 250, y);
  doc.text(`Estado: ${f.estado}`, 420, y);

  y += 30;
  doc.setFontSize(11);
  for (const [k, v] of filasFactura(f)) {
    doc.setFont('helvetica', 'bold').text(k, 56, y);
    doc.setFont('helvetica', 'normal').text(v, 250, y);
    y += 20;
  }

  y += 12;
  doc.setDrawColor(200).line(56, y, 539, y);
  y += 26;
  doc.setFontSize(14).setFont('helvetica', 'bold').text('Total', 56, y);
  doc.text(fmt(f.total), 539, y, { align: 'right' });

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
    fila('N.º', f.id.slice(0, 8)),
    fila('Fecha', f.createdAt.slice(0, 10)),
    fila('Estado', f.estado),
    vacio(),
    ...filasFactura(f).map(([k, v]) => fila(k, v)),
    vacio(),
    new Paragraph({ children: [new TextRun({ text: `Total: ${fmt(f.total)}`, bold: true, size: 28 })] }),
  ];

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  descargarBlob(blob, nombreArchivo(f, 'docx'));
}
