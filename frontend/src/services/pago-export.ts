import type { PagoDetalle } from './pago-detalle-service';
import { fmt, sanitizarPdf, encabezadoMarca, tituloConBadge, filaEncabezado, tablaMonetaria } from './pdf-documento';

const ETIQUETA_ITEM: Record<string, string> = {
  factura: 'Factura',
  nota_debito: 'Nota de débito',
  nota_credito: 'Nota de crédito',
};

/** Documento puramente monetario: filas de encabezado + desglose (si lo
 *  hay) + bancas + total — esquinas cuadradas en todo. */
export async function descargarPagoPDF(pago: PagoDetalle, esProveedor: boolean): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  encabezadoMarca(doc);

  const titulo = esProveedor ? 'Comprobante de pago' : 'Comprobante de cobro';
  let y = 56 + 52;
  tituloConBadge(doc, y, titulo, null);

  y += 22;
  const ref = pago.codigoPago ?? pago.codigoAdelanto ?? `N.º ${pago.grupoId.slice(0, 8)}`;
  y = filaEncabezado(doc, y, 'Ref.', `${ref}  ·  ${pago.fecha}`);
  y = filaEncabezado(doc, y, esProveedor ? 'Proveedor' : 'Cliente', pago.nombreEntidad);
  if (pago.items.length === 0 && pago.descripcion) {
    y = filaEncabezado(doc, y, 'Descripción', pago.descripcion);
  }
  y = filaEncabezado(doc, y, 'Registrado por', pago.registradoPor ?? '—');

  if (pago.items.length > 0) {
    y += 6;
    const itemsBody = pago.items.map(it => [
      sanitizarPdf(it.codigo ?? '—'),
      ETIQUETA_ITEM[it.tipo],
      `${it.tipo === 'nota_credito' ? '-' : ''}$${fmt(it.montoUsd)}`,
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

  y += 30;
  doc.setDrawColor(120).setLineWidth(1.5).line(56, y, 539, y);
  y += 24;
  doc.setFontSize(20).setFont('helvetica', 'bold').setTextColor(0).text('Total', 56, y);
  doc.text(`$${fmt(pago.totalUsd)}`, 539, y, { align: 'right' });

  const nombreArchivo = (pago.codigoPago ?? pago.codigoAdelanto ?? pago.grupoId.slice(0, 8)).replace(/\s+/g, '-').toLowerCase();
  doc.save(`${esProveedor ? 'pago' : 'cobro'}-${nombreArchivo}.pdf`);
}
