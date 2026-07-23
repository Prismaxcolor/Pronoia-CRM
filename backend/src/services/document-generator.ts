import { jsPDF } from 'jspdf';
import type { FacturaPublica, ItemPublico } from './factura-service.js';
import type { TicketPublico, MaterialPublico } from './ticket-pesaje-service.js';

// Réplica server-side de frontend/src/services/factura-export.ts (descargarFacturaPDF):
// mismo armado de documento, solo cambia la salida final (arraybuffer en vez de
// doc.save() en el navegador) para que el PDF que se manda por Telegram sea igual al
// que se ve/descarga en la web — un solo diseño de verdad.

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

function lineaTextoFactura(it: ItemPublico): string {
  return `${it.nombreProducto ?? 'material'} · ${fmt(it.peso)} kg × ${fmt(it.precioUnitario)} = ${fmt(it.subtotal)}`;
}

function lineaTextoMaterial(m: MaterialPublico): string {
  const devolucion = m.devolucion ? ` − devolución ${fmt(m.devolucion)} kg` : '';
  return `${m.nombreProducto ?? m.subcategoria ?? 'material'} · bruto ${fmt(m.pesoBruto)} kg − tara ${fmt(m.tara)} kg${devolucion} = neto ${fmt(m.pesoNeto)} kg`;
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
  for (const [k, v] of filasFactura(f)) {
    doc.setFont('helvetica', 'bold').text(k, 56, y);
    doc.setFont('helvetica', 'normal').text(v, 250, y);
    y += 20;
  }

  y += 6;
  doc.setFont('helvetica', 'bold').text('Líneas', 56, y);
  y += 18;
  doc.setFont('helvetica', 'normal').setFontSize(10);
  for (const it of consolidarItems(f.items)) {
    doc.text(lineaTextoFactura(it), 56, y);
    y += 16;
  }
  doc.setFontSize(11);

  y += 12;
  doc.setDrawColor(200).line(56, y, 539, y);
  y += 26;
  doc.setFontSize(14).setFont('helvetica', 'bold').text('Total', 56, y);
  doc.text(fmt(f.total), 539, y, { align: 'right' });

  return Buffer.from(doc.output('arraybuffer'));
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
  doc.setFont('helvetica', 'normal').text(nombreEntidad, 250, y);
  y += 20;
  if (t.observaciones) {
    doc.setFont('helvetica', 'bold').text('Observaciones', 56, y);
    doc.setFont('helvetica', 'normal').text(t.observaciones, 250, y);
    y += 20;
  }

  y += 6;
  doc.setFont('helvetica', 'bold').text('Materiales', 56, y);
  y += 18;
  doc.setFont('helvetica', 'normal').setFontSize(10);
  for (const m of t.materiales) {
    doc.text(lineaTextoMaterial(m), 56, y);
    y += 16;
  }
  doc.setFontSize(11);

  y += 12;
  doc.setDrawColor(200).line(56, y, 539, y);
  y += 26;
  doc.setFontSize(14).setFont('helvetica', 'bold').text('Peso neto total', 56, y);
  doc.text(`${fmt(t.pesoNetoTotal)} kg`, 539, y, { align: 'right' });

  return Buffer.from(doc.output('arraybuffer'));
}
