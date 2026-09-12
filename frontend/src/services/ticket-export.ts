import type { TicketPesaje } from '@shared/types/index.js';
import { destinoLabel } from '@shared/types/index.js';
import { fmt, sanitizarPdf, encabezadoMarca, tituloConBadge, subtitulo, filaEncabezado, tablaPesaje, type Badge } from './pdf-documento';

/** "Borrador" es naranja en el ticket (no gris, que es lo que le tocaría
 *  por la clave compartida 'borrador' que usa factura) — por eso lleva
 *  color explícito. El preview también puede mostrar "Pesaje exterior"
 *  como segundo badge, a la vez que el de estado. */
function badges(ticket: TicketPesaje): Badge[] {
  const estado: Badge = ticket.estado === 'bruto'
    ? { texto: 'Borrador', color: [194, 65, 12] }
    : { texto: ticket.facturado ? 'Facturado' : 'Pendiente por facturar' };
  const lista = [estado];
  if (ticket.pesajeExterior) lista.push({ texto: 'Pesaje exterior', color: [126, 34, 206] });
  return lista;
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
  tituloConBadge(doc, y, titulo, badges(ticket));

  y += 16;
  subtitulo(doc, y, `Ref. ${ticket.codigo}  ·  ${esCompra ? 'Compra' : 'Venta'}  ·  ${ticket.fecha ?? ticket.createdAt.slice(0, 10)}`);

  y += 26;
  y = filaEncabezado(doc, y, esCompra ? 'Proveedor' : 'Cliente', nombreEntidad);
  if (ticket.observaciones) y = filaEncabezado(doc, y, 'Observaciones', ticket.observaciones);

  y += 6;
  if (ticket.pesajeExterior) {
    doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(130)
      .text('Pesaje exterior — sin peso global propio.', 56, y);
    doc.setTextColor(0);
    y += 10;
  } else {
    doc.setFontSize(15).setFont('helvetica', 'bold').setTextColor(0).text('Peso global', 56, y);
    doc.setFontSize(20).text(`${fmt(ticket.pesoGlobal)} kg`, 539, y, { align: 'right' });
    y += 18;
    doc.setFontSize(10).setFont('helvetica', 'normal').setTextColor(90).text('Peso neto', 56, y);
    doc.setFont('helvetica', 'bold').setTextColor(15).text(`${fmt(ticket.pesoNetoTotal)} kg`, 539, y, { align: 'right' });
    doc.setTextColor(0);
    y += 10;
  }

  if (ticket.estado !== 'bruto') {
    y += 20;
    const materialesBody = ticket.materiales.map(m => [
      sanitizarPdf(m.nombreProducto ?? '—'),
      sanitizarPdf(destinoLabel(m.destinoTipo, m.nombreLote)),
      fmt(m.pesoBruto),
      fmt(m.tara),
      fmt(m.pesoNeto),
    ]);
    const foot = ticket.devolucion > 0
      ? [[{ content: 'Devolución', colSpan: 4 }, `${fmt(ticket.devolucion)}`]]
      : undefined;
    y = tablaPesaje(doc, autoTable, {
      startY: y,
      head: [['Material', 'Destino', 'Bruto', 'Tara', 'Neto (kg)']],
      body: materialesBody,
      foot,
    });
  } else {
    y += 30;
    doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(180, 130, 40)
      .text('Ticket en borrador — materiales pendientes de registro. No contabilizado en inventario.', 56, y);
  }

  doc.save(`ticket-pesaje-${ticket.codigo.replace(/\s+/g, '-').toLowerCase()}.pdf`);
}
