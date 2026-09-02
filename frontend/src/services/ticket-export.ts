import type { TicketPesaje } from '@shared/types/index.js';
import { fmt, sanitizarPdf, encabezadoMarca, tituloConBadge, filaEncabezado, tablaPesaje } from './pdf-documento';

function badgeTexto(ticket: TicketPesaje): string {
  if (ticket.estado === 'bruto') return 'Borrador';
  return ticket.facturado ? 'Facturado' : 'Pendiente por facturar';
}

/** Documento 100% de pesaje: encabezado universal + tabla en caja
 *  redondeada — mismas 4 columnas (Material/Bruto/Tara/Neto) que el ticket
 *  embebido dentro de una factura, para que todo el sistema use exactamente
 *  el mismo formato de ticket de pesaje. */
export async function descargarTicketPDF(ticket: TicketPesaje, nombreEntidad: string, esCompra: boolean): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  encabezadoMarca(doc);

  const titulo = ticket.estado === 'bruto' ? 'Ticket de pesaje en bruto' : 'Ticket de pesaje';
  let y = 56 + 52;
  tituloConBadge(doc, y, titulo, badgeTexto(ticket));

  y += 22;
  y = filaEncabezado(doc, y, 'Ref.', `${ticket.codigo}  ·  ${esCompra ? 'Compra' : 'Venta'}  ·  ${ticket.fecha ?? ticket.createdAt.slice(0, 10)}`);
  y = filaEncabezado(doc, y, esCompra ? 'Proveedor' : 'Cliente', nombreEntidad);
  if (ticket.observaciones) y = filaEncabezado(doc, y, 'Observaciones', ticket.observaciones);

  y += 6;
  if (!ticket.pesajeExterior) {
    doc.setFontSize(15).setFont('helvetica', 'bold').setTextColor(0).text('Peso global', 56, y);
    doc.setFontSize(20).text(`${fmt(ticket.pesoGlobal)} kg`, 539, y, { align: 'right' });
    y += 10;
  }

  if (ticket.estado !== 'bruto') {
    y += 20;
    const materialesBody = ticket.materiales.map(m => [
      sanitizarPdf(m.nombreProducto ?? '—'),
      fmt(m.pesoBruto),
      fmt(m.tara),
      fmt(m.pesoNeto),
    ]);
    const footRows = ticket.devolucion > 0
      ? [['Total del ticket', '', '', `${fmt(ticket.pesoNetoTotal)} kg`], ['Devolución', '', '', `${fmt(ticket.devolucion)} kg`]]
      : [['Total del ticket', '', '', `${fmt(ticket.pesoNetoTotal)} kg`]];
    y = tablaPesaje(doc, autoTable, {
      startY: y,
      head: [['Material', 'Bruto', 'Tara', 'Neto (kg)']],
      body: materialesBody,
      foot: footRows,
    });
  } else {
    y += 30;
    doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(180, 130, 40)
      .text('Ticket en borrador — materiales pendientes de registro. No contabilizado en inventario.', 56, y);
  }

  doc.save(`ticket-pesaje-${ticket.codigo.replace(/\s+/g, '-').toLowerCase()}.pdf`);
}
