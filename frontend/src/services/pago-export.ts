import type { PagoDetalle } from './pago-detalle-service';
import { entregarPdf, type ArchivoPdf, type ModoPdf, fmt, sanitizarPdf, encabezadoMarca, tituloConBadge, subtitulo, filaEncabezado, tablaMonetaria } from './pdf-documento';

const ETIQUETA_ITEM: Record<string, string> = {
  factura: 'Factura',
  nota_debito: 'Nota de débito',
  nota_credito: 'Nota de crédito',
  adelanto: 'Adelanto',
};

/** Documento puramente monetario: filas de encabezado + desglose (si lo
 *  hay) + bancas + total — esquinas cuadradas en todo. */
export async function descargarPagoPDF(pago: PagoDetalle, esProveedor: boolean, modo: ModoPdf = 'descargar'): Promise<ArchivoPdf | undefined> {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  encabezadoMarca(doc);

  const esCruce = pago.codigoCruce != null;
  const titulo = esCruce ? 'Comprobante de cruce' : esProveedor ? 'Comprobante de pago' : 'Comprobante de cobro';
  // Código de pago (verde) o de adelanto (verde azulado) como píldora junto
  // al título — igual que en el preview en pantalla. Ninguno de los dos es
  // un "estado", por eso necesitan color explícito en vez del lookup normal.
  const codigo = pago.codigoPago ?? pago.codigoAdelanto ?? pago.codigoCruce ?? null;
  const colorCodigo: [number, number, number] | undefined = pago.codigoPago
    ? [21, 128, 61]
    : pago.codigoAdelanto ? [15, 118, 110] : pago.codigoCruce ? [67, 56, 202] : undefined;
  let y = 56 + 52;
  tituloConBadge(doc, y, titulo, codigo ? { texto: codigo, color: colorCodigo } : null);

  y += 16;
  subtitulo(doc, y, pago.fecha);

  y += 26;
  y = filaEncabezado(doc, y, esProveedor ? 'Proveedor' : 'Cliente', pago.nombreEntidad);
  y = filaEncabezado(doc, y, 'Fecha', pago.fecha);
  if (pago.items.length === 0 && pago.descripcion) {
    y = filaEncabezado(doc, y, 'Descripción', pago.descripcion);
  }
  y = filaEncabezado(doc, y, 'Registrado por', pago.registradoPor ?? '—');

  if (pago.items.length > 0) {
    y += 6;
    const itemsBody = pago.items.map(it => [
      sanitizarPdf(it.codigo ?? '—'),
      ETIQUETA_ITEM[it.tipo],
      `${it.tipo === 'nota_credito' || it.tipo === 'adelanto' ? '-' : ''}$${fmt(it.montoUsd)}`,
    ]);
    y = tablaMonetaria(doc, autoTable, {
      startY: y,
      head: [['Código', 'Tipo', 'Monto']],
      body: itemsBody,
    });
    y += 20;
  } else {
    y += 6;
  }

  if (!esCruce) {
  const bancasBody = pago.bancas.map(b => [
    sanitizarPdf(b.bancaNombre ?? '—'),
    `${fmt(b.monto)} ${b.moneda}`,
    b.referencia ? sanitizarPdf(b.referencia) : '—',
  ]);
  doc.setFontSize(11).setFont('helvetica', 'bold').setTextColor(0)
    .text(pago.bancas.length > 1 ? 'Bancas' : 'Banca', 56, y);
  y += 8;
  y = tablaMonetaria(doc, autoTable, {
    startY: y,
    head: [['Banca', 'Monto', 'Referencia']],
    body: bancasBody,
  });
  } else {
    doc.setFontSize(10).setFont('helvetica', 'normal').setTextColor(80)
      .text('Cruce sin movimiento de dinero: no se uso banca ni metodo de pago.', 56, y + 6);
    y += 14;
  }

  y += 30;
  doc.setDrawColor(120).setLineWidth(1.5).line(56, y, 539, y);
  y += 24;
  doc.setFontSize(20).setFont('helvetica', 'bold').setTextColor(0).text(esCruce ? 'Total en efectivo/banco' : 'Total', 56, y);
  doc.text(`$${fmt(pago.totalUsd)}`, 539, y, { align: 'right' });

  const nombreArchivo = (pago.codigoPago ?? pago.codigoAdelanto ?? pago.codigoCruce ?? pago.grupoId.slice(0, 8)).replace(/\s+/g, '-').toLowerCase();
  return entregarPdf(doc, `${esCruce ? 'cruce' : esProveedor ? 'pago' : 'cobro'}-${nombreArchivo}.pdf`, modo);
}
