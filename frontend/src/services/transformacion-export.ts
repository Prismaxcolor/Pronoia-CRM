import type { Transformacion } from '@shared/types/index.js';
import { fmt, sanitizarPdf, encabezadoMarca, tituloConBadge, subtitulo, filaEncabezado, tablaPesaje, type Badge } from './pdf-documento';

export interface NombresTransformacion {
  almacen: string | null;
  registradoPor: string | null;
  completadoPor: string | null;
}

function badgeEstado(t: Transformacion): Badge {
  return t.estado === 'completa'
    ? { texto: 'Completa', color: [21, 128, 61] }
    : { texto: 'Pendiente', color: [194, 65, 12] };
}

function fechaHora(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace('T', ' ') : '—';
}

/** Documento de la transformación: encabezado universal + tabla de salidas en
 *  caja redondeada (mismo patrón que ticket-export.ts). No incluye la
 *  valoración (precios/ganancia): es información interna, no del documento. */
export async function descargarTransformacionPDF(t: Transformacion, nombres: NombresTransformacion): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  encabezadoMarca(doc);

  const codigo = t.codigo ?? t.id.slice(0, 8);
  let y = 56 + 52;
  tituloConBadge(doc, y, 'Transformación', [badgeEstado(t)]);
  y += 16;
  subtitulo(doc, y, `Ref. ${codigo}  ·  ${t.categoria === 'pcb' ? 'PCB' : 'Ferroso / No ferroso'}  ·  ${t.fecha}`);

  y += 26;
  y = filaEncabezado(doc, y, 'Material de entrada', t.nombreProductoEntrada ?? t.nombreLoteOrigen ?? '—');
  if (nombres.almacen) y = filaEncabezado(doc, y, 'Almacén de origen', nombres.almacen);
  y = filaEncabezado(doc, y, 'Registrada por', `${nombres.registradoPor ?? '—'} (${fechaHora(t.createdAt)})`);
  if (t.estado === 'completa') {
    y = filaEncabezado(doc, y, 'Completada por', `${nombres.completadoPor ?? '—'} (${fechaHora(t.completadoEn)})`);
  }
  if (t.notas) y = filaEncabezado(doc, y, 'Notas', t.notas);

  y += 6;
  doc.setFontSize(15).setFont('helvetica', 'bold').setTextColor(0).text('Peso de entrada', 56, y);
  doc.setFontSize(20).text(`${fmt(t.pesoNeto)} kg`, 539, y, { align: 'right' });
  y += 18;
  doc.setFontSize(10).setFont('helvetica', 'normal').setTextColor(90)
    .text(`Bruto ${fmt(t.pesoBruto)} kg  -  Tara ${fmt(t.tara)} kg`, 56, y);
  doc.setTextColor(0);

  if (t.salidas.length > 0) {
    y += 30;
    const totalSalidas = t.salidas.reduce((acc, s) => acc + s.pesoNeto, 0);
    tablaPesaje(doc, autoTable, {
      startY: y,
      head: [['Salida', 'Almacén', 'Bruto', 'Tara', 'Neto (kg)']],
      body: t.salidas.map(s => [
        sanitizarPdf(s.nombreProducto ?? s.nombreLoteDestino ?? '—'),
        sanitizarPdf(s.nombreAlmacen ?? '—'),
        fmt(s.pesoBruto),
        fmt(s.tara),
        fmt(s.pesoNeto),
      ]),
      foot: [
        [{ content: 'Total salidas', colSpan: 4 }, fmt(totalSalidas)],
        [{ content: 'Merma', colSpan: 4 }, fmt(t.pesoNeto - totalSalidas)],
      ],
    });
  }

  doc.save(`transformacion-${codigo.replace(/\s+/g, '-').toLowerCase()}.pdf`);
}
