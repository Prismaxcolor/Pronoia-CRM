import type { TomaFisicaInventario, DetalleTomaFisica, ResumenTomaFisicaLinea } from '@shared/types/index.js';
import { fmt, sanitizarPdf, encabezadoMarca, tituloConBadge, filaEncabezado, tablaPesaje } from './pdf-documento';

function fmtFecha(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-VE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Documento 100% de pesaje/inventario: encabezado universal + dos tablas en
 *  caja redondeada (ticket agrupado, y teórico vs. real). */
export async function descargarTomaFisicaPDF(
  tomaFisica: TomaFisicaInventario,
  detalle: DetalleTomaFisica[],
  lineas: ResumenTomaFisicaLinea[]
): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  encabezadoMarca(doc);

  let y = 56 + 52;
  tituloConBadge(doc, y, tomaFisica.codigo, tomaFisica.estado === 'abierta' ? 'Abierta' : 'Cerrada');

  y += 22;
  y = filaEncabezado(doc, y, 'Almacén', tomaFisica.almacenNombre ?? '—');
  y = filaEncabezado(doc, y, 'Categorías', tomaFisica.categoriaNombres.join(', '));
  if (tomaFisica.loteNombres.length > 0) y = filaEncabezado(doc, y, 'Lote(s)', tomaFisica.loteNombres.join(', '));
  if (tomaFisica.descripcion) y = filaEncabezado(doc, y, 'Descripción', tomaFisica.descripcion);
  y = filaEncabezado(doc, y, 'Abierta', fmtFecha(tomaFisica.abiertaEn));
  if (tomaFisica.estado === 'cerrada') y = filaEncabezado(doc, y, 'Cerrada', fmtFecha(tomaFisica.cerradaEn));

  y += 10;
  const ticketPorMaterial = detalle.reduce((mapa, d) => {
    const clave = `${d.productoId}-${d.loteId ?? 'sin-lote'}`;
    const actual = mapa.get(clave);
    if (actual) { actual.pesoNeto += d.pesoNeto; actual.cantidad += 1; }
    else mapa.set(clave, { nombreProducto: d.nombreProducto, nombreLote: d.nombreLote, pesoNeto: d.pesoNeto, cantidad: 1 });
    return mapa;
  }, new Map<string, { nombreProducto: string | null; nombreLote: string | null; pesoNeto: number; cantidad: number }>());

  if (ticketPorMaterial.size > 0) {
    doc.setFontSize(13).setFont('helvetica', 'bold').setTextColor(0)
      .text(`Ticket de la toma física (${detalle.length} pesaje${detalle.length === 1 ? '' : 's'})`, 56, y);
    y += 14;
    const body = Array.from(ticketPorMaterial.values()).map(m => [
      sanitizarPdf(m.nombreProducto ?? 'Lote completo'),
      sanitizarPdf(m.nombreLote ?? '—'),
      String(m.cantidad),
      fmt(m.pesoNeto),
    ]);
    y = tablaPesaje(doc, autoTable, {
      startY: y,
      head: [['Material', 'Lote', 'Pesajes', 'Peso neto (kg)']],
      body,
    });
    y += 20;
  }

  if (lineas.length > 0) {
    const totalTeorico = lineas.reduce((acc, l) => acc + l.stockTeorico, 0);
    const totalReal = lineas.reduce((acc, l) => acc + l.stockReal, 0);
    const totalDiferencia = totalReal - totalTeorico;

    doc.setFontSize(13).setFont('helvetica', 'bold').setTextColor(0)
      .text('Teórico (sistema) vs. real (contado)', 56, y);
    y += 14;
    const body = lineas.map(l => [
      sanitizarPdf(l.productoNombre ?? 'Lote completo'),
      sanitizarPdf(l.loteNombre ?? '—'),
      fmt(l.stockTeorico),
      fmt(l.stockReal),
      `${l.diferencia > 0 ? '+' : ''}${fmt(l.diferencia)}`,
    ]);
    const foot = [['Total', '', fmt(totalTeorico), fmt(totalReal), `${totalDiferencia > 0 ? '+' : ''}${fmt(totalDiferencia)} kg`]];
    y = tablaPesaje(doc, autoTable, {
      startY: y,
      head: [['Material', 'Lote', 'Teórico', 'Real', 'Diferencia']],
      body,
      foot,
    });
  }

  doc.save(`toma-fisica-${tomaFisica.codigo.replace(/\s+/g, '-').toLowerCase()}.pdf`);
}
