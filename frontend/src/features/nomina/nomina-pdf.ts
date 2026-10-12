import { nombreArchivoDocumento } from '../../lib/nombre-archivo';
import { formatearFecha } from '../../lib/formato';
import { formatearFechaHora } from '../../lib/fecha-negocio';
import {
  entregarPdf, sanitizarPdf, encabezadoMarca, tituloConBadge, subtitulo, filaEncabezado, pieRegistro,
  BOX_LEFT, BOX_RIGHT, type ArchivoPdf, type ModoPdf,
} from '../../services/pdf-documento';
import {
  ETIQUETA_ESTADO_NOMINA, ETIQUETA_TIPO_TRABAJADOR, formatearNumeroNomina, type Nomina,
} from '../../../../shared/types/nomina.js';
import { domingoDe } from '../../../../shared/types/nomina-calculo.js';
import { ENCABEZADO_TABLA_PDF, filasPagos, filasTabla, filasTotales } from './nomina-pdf-filas';

const GRIS_GRID: [number, number, number] = [70, 70, 70];

/**
 * Nómina semanal en PDF (una por tipo de personal). Solo lleva nombre, días y montos: ningún dato de contacto ni de pago
 * de la ficha del trabajador. Se imprime desde el visor del navegador o se descarga.
 */
export async function descargarNominaPDF(n: Nomina, modo: ModoPdf = 'descargar'): Promise<ArchivoPdf | undefined> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  encabezadoMarca(doc);
  let y = 56 + 52;
  tituloConBadge(doc, y, `Nómina ${formatearNumeroNomina(n.numero)}`, ETIQUETA_ESTADO_NOMINA[n.estado]);
  y += 16;
  subtitulo(doc, y, `${ETIQUETA_TIPO_TRABAJADOR[n.tipo]} · semana del ${formatearFecha(n.semanaInicio)} al ${formatearFecha(domingoDe(n.semanaInicio))}`);
  y += 26;
  y = filaEncabezado(doc, y, 'Tasa (Bs por USD)', n.tasaBs === null ? 'Sin tasa' : n.tasaBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 }));

  autoTable(doc, {
    startY: y,
    head: [ENCABEZADO_TABLA_PDF],
    body: filasTabla(n),
    margin: { left: BOX_LEFT, right: 595.28 - BOX_RIGHT },
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 4, lineWidth: 0.5, lineColor: GRIS_GRID },
    headStyles: { fillColor: [245, 245, 245], textColor: 0, fontStyle: 'bold' },
    columnStyles: Object.fromEntries([2, 3, 4, 5, 6, 7, 8, 9].map(i => [i, { halign: 'right' }])),
    theme: 'grid',
  });

  let yTotales = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
  for (const [etiqueta, valor] of [...filasTotales(n.totales), ...filasPagos(n)]) {
    if (yTotales > 760) { doc.addPage(); yTotales = 56; }
    yTotales = filaEncabezado(doc, yTotales, etiqueta, valor);
  }
  if (n.estado === 'ANULADA' && n.anuladaMotivo) {
    filaEncabezado(doc, yTotales, 'Anulada', `${n.anuladaMotivo}${n.anuladaEn ? ` (${formatearFechaHora(n.anuladaEn)})` : ''}`);
  }

  doc.setFontSize(8).setTextColor(110).text(
    sanitizarPdf('Documento con datos personales del personal: de uso interno.'), BOX_LEFT, 786,
  );
  doc.setTextColor(0);
  pieRegistro(doc, [n.cerradaEn ? `Cerrada el ${formatearFechaHora(n.cerradaEn)}` : 'Borrador: aún no cerrada']);
  const nombre = nombreArchivoDocumento({
    prefijo: 'Nomina', codigo: formatearNumeroNomina(n.numero), entidad: `${ETIQUETA_TIPO_TRABAJADOR[n.tipo]} ${n.semanaInicio}`,
  });
  return entregarPdf(doc, nombre, modo);
}
