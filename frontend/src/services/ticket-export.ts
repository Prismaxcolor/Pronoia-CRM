import type { TicketPesaje } from '@shared/types/index.js';
import { destinoLabel, describirTarasDetalle } from '@shared/types/index.js';
import { nombreArchivoDocumento } from '../lib/nombre-archivo';
import { fechaPesajeGlobal, lineasAutoriaTicket, tituloTicket, totalKgPesados } from '../lib/ticket-documento';
import { entregarPdf, type ArchivoPdf, type ModoPdf, fmt, sanitizarPdf, encabezadoMarca, tituloConBadge, subtitulo, filaEncabezado, pieRegistro, tablaPesaje, type Badge } from './pdf-documento';
import { formatearFecha } from '../lib/formato';

/** "Por recepcionar" es naranja en el ticket (no gris, que es lo que le tocaría
 *  por la clave compartida 'borrador' que usa factura) — por eso lleva
 *  color explícito. El preview también puede mostrar "Pesaje exterior"
 *  como segundo badge, a la vez que el de estado. */
function badges(ticket: TicketPesaje): Badge[] {
  const estado: Badge = ticket.estado === 'bruto'
    ? { texto: 'Por recepcionar (pesaje global)', color: [194, 65, 12] }
    : { texto: ticket.facturado ? 'Facturado' : 'Pendiente por facturar' };
  const lista = [estado];
  if (ticket.pesajeExterior) lista.push({ texto: 'Sin pesaje global', color: [126, 34, 206] });
  return lista;
}

/** Documento 100% de pesaje: encabezado universal + tabla en caja
 *  redondeada — mismas 4 columnas (Material/Bruto/Tara/Neto) que el ticket
 *  embebido dentro de una factura, para que todo el sistema use exactamente
 *  el mismo formato de ticket de pesaje. */
export async function descargarTicketPDF(ticket: TicketPesaje, nombreEntidad: string, esCompra: boolean, modo: ModoPdf = 'descargar'): Promise<ArchivoPdf | undefined> {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  encabezadoMarca(doc);

  const titulo = tituloTicket(ticket.estado);
  let y = 56 + 52;
  tituloConBadge(doc, y, titulo, badges(ticket));

  y += 16;
  subtitulo(doc, y, `Ref. ${ticket.codigo}  ·  ${esCompra ? 'Compra' : 'Venta'}  ·  ${formatearFecha(fechaPesajeGlobal(ticket))}`);

  y += 26;
  y = filaEncabezado(doc, y, esCompra ? 'Proveedor' : 'Cliente', nombreEntidad);
  if (!ticket.pesajeExterior) y = filaEncabezado(doc, y, 'Fecha del pesaje global', formatearFecha(fechaPesajeGlobal(ticket)));
  if (ticket.observaciones) y = filaEncabezado(doc, y, 'Observaciones', ticket.observaciones);
  if (ticket.notasCompletado) y = filaEncabezado(doc, y, 'Notas', ticket.notasCompletado);

  y += 6;
  if (ticket.pesajeExterior) {
    doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(130)
      .text('Sin pesaje global.', 56, y);
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
      sanitizarPdf(`${m.nombreProducto ?? '—'}${m.tarasDetalle?.length ? `\nTara: ${describirTarasDetalle(m.tarasDetalle, fmt)}` : ''}`),
      sanitizarPdf(destinoLabel(m.destinoTipo, m.nombreLote)),
      fmt(m.pesoBruto),
      fmt(m.tara),
      fmt(m.pesoNeto),
    ]);
    const foot = [
      ...(ticket.devolucion > 0 ? [[{ content: 'Devolución', colSpan: 4 }, `${fmt(ticket.devolucion)}`]] : []),
      [{ content: 'Total de kg pesados', colSpan: 4 }, `${fmt(totalKgPesados(ticket))} kg`],
    ];
    tablaPesaje(doc, autoTable, {
      startY: y,
      head: [['Material', 'Destino', 'Bruto', 'Tara', 'Neto (kg)']],
      body: materialesBody,
      foot,
    });
  } else {
    y += 30;
    doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(180, 130, 40)
      .text('Pesaje global por recepcionar — materiales pendientes de registro. No contabilizado en inventario.', 56, y);
  }

  const autoria = lineasAutoriaTicket(ticket);
  pieRegistro(doc, [autoria.registro, autoria.completado, autoria.edicion]);

  return entregarPdf(doc, nombreArchivoDocumento({ prefijo: 'Ticket', codigo: ticket.codigo, entidad: nombreEntidad }), modo);
}
