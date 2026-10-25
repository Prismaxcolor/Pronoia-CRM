import type { EmpresaPackingList, IdiomaPackingList, PackingListDetalle, TipoEmbalajePackingList } from '@shared/types/index.js';
import { descargarBlob, pieSinConexionPdf, sanitizarPdf } from './pdf-documento';
import {
  ETIQUETA_EMBALAJE,
  NOMBRE_BULTO,
  calcularTotales,
  etiquetaLote,
  formatearFechaDocumento,
  formatearPeso,
  nombreColor,
  resumirPorLote,
  type FilaPackingList,
  type ResumenGrupo,
} from '../lib/packing-list';

/**
 * Packing list de exportación en PDF, calcado del documento real (CONT 06): página 1 con el resumen
 * por lote y página 2 con el detalle de pesos por big bag/paleta. Un documento por idioma
 * (es = dirección de Venezuela, en = dirección de EE.UU.); ambos salen de los mismos datos.
 */

const MARGEN = 40;
const NEGRO = 0;
const UNIDAD = 'KGS';

interface Textos {
  titulo: string;
  tituloDetalle: string;
  direccionFiscal: string;
  telefono: string;
  fecha: string;
  contenedor: string;
  item: string;
  descripcion: string;
  pesoNeto: string;
  unidad: string;
  total: string;
  totalKg: string;
  observaciones: string;
  pesoBruto: string;
  numeroPaleta: string;
  pesoPaleta: string;
  totales: string;
  numeroBulto: Record<TipoEmbalajePackingList, string>;
}

const TEXTOS: Record<IdiomaPackingList, Textos> = {
  en: {
    titulo: 'PACKING LIST',
    tituloDetalle: 'DETAILED LIST OF WEIGHTS',
    direccionFiscal: 'Fiscal address:',
    telefono: 'TLF:',
    fecha: 'DATE:',
    contenedor: 'CONTAINER',
    item: 'ITEM',
    descripcion: 'DESCRIPTION',
    pesoNeto: 'NET WEIGHT',
    unidad: 'UNIT',
    total: 'TOTAL',
    totalKg: 'TOTAL KG',
    observaciones: 'OBSERVATIONS:',
    pesoBruto: 'GROSS WEIGHT',
    numeroPaleta: 'PALLET NUMBER',
    pesoPaleta: 'PALLET WEIGHT',
    totales: 'TOTALS',
    numeroBulto: { big_bag: 'BIG BAG NUMBER', paleta: 'PALLET NUMBER', paquete: 'PACKAGE NUMBER' },
  },
  es: {
    titulo: 'LISTA DE EMPAQUE (PACKING LIST)',
    tituloDetalle: 'LISTA DETALLADA DE PESOS',
    direccionFiscal: 'Dirección fiscal:',
    telefono: 'TLF:',
    fecha: 'FECHA:',
    contenedor: 'CONTENEDOR',
    item: 'ÍTEM',
    descripcion: 'DESCRIPCIÓN',
    pesoNeto: 'PESO NETO',
    unidad: 'UNIDAD',
    total: 'TOTAL',
    totalKg: 'TOTAL KG',
    observaciones: 'OBSERVACIONES:',
    pesoBruto: 'PESO BRUTO',
    numeroPaleta: 'N.º PALETA',
    pesoPaleta: 'PESO PALETA',
    totales: 'TOTALES',
    numeroBulto: { big_bag: 'N.º BIG BAG', paleta: 'N.º PALETA', paquete: 'N.º PAQUETE' },
  },
};

export function nombreArchivoPackingList(p: Pick<PackingListDetalle, 'contenedor'>, idioma: IdiomaPackingList): string {
  const ref = p.contenedor.trim().replace(/[^\w-]+/g, '-').toLowerCase() || 'sin-contenedor';
  return `packing-list-${ref}-${idioma}.pdf`;
}

const descripcionDe = (p: PackingListDetalle, idioma: IdiomaPackingList): string =>
  (idioma === 'en' ? p.descripcionEn : p.descripcionEs)?.trim() ?? '';

const observacionesDe = (p: PackingListDetalle, idioma: IdiomaPackingList): string =>
  (idioma === 'en' ? p.observacionesEn : p.observacionesEs)?.trim() ?? '';

function filasDe(p: PackingListDetalle): FilaPackingList[] {
  return p.items.map(i => ({ ...i }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AutoTable = any;

/** Cabecera de empresa (izquierda) + fecha y contenedor (derecha). Devuelve la Y siguiente. */
function dibujarEncabezado(doc: Doc, p: PackingListDetalle, empresa: EmpresaPackingList | undefined, idioma: IdiomaPackingList): number {
  const t = TEXTOS[idioma];
  const ancho = doc.internal.pageSize.getWidth();
  const lineas: string[] = [];
  if (empresa?.nombre) lineas.push(empresa.nombre);
  if (empresa?.direccion) lineas.push(...empresa.direccion.split('\n').map(l => l.trim()).filter(Boolean));
  if (empresa?.telefono) lineas.push(`${t.telefono} ${empresa.telefono}`);
  if (empresa?.email) lineas.push(empresa.email);

  let y = 50;
  doc.setTextColor(NEGRO).setFont('helvetica', 'bold').setFontSize(9).text(t.direccionFiscal, MARGEN, y);
  doc.setFont('helvetica', 'normal');
  for (const l of lineas) {
    y += 12;
    doc.text(sanitizarPdf(l), MARGEN, y, { maxWidth: ancho / 2 - MARGEN });
  }
  doc.setFont('helvetica', 'bold').setFontSize(10);
  doc.text(`${t.fecha} ${formatearFechaDocumento(p.fecha, idioma)}`, ancho - MARGEN, 50, { align: 'right' });
  doc.text(`${t.contenedor} ${sanitizarPdf(p.contenedor)}`, ancho - MARGEN, 64, { align: 'right' });
  return Math.max(y, 64) + 26;
}

function dibujarTitulo(doc: Doc, y: number, texto: string): number {
  const ancho = doc.internal.pageSize.getWidth();
  const lineas: string[] = doc.setFont('helvetica', 'bold').setFontSize(13).splitTextToSize(sanitizarPdf(texto), ancho - MARGEN * 2);
  doc.text(lineas, ancho / 2, y, { align: 'center' });
  return y + lineas.length * 16 + 8;
}

const ESTILO_TABLA = {
  theme: 'grid',
  margin: { left: MARGEN, right: MARGEN },
  styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, lineColor: NEGRO, lineWidth: 0.5, textColor: NEGRO, valign: 'middle' },
  headStyles: { fillColor: [255, 255, 255], textColor: NEGRO, fontStyle: 'bold', halign: 'center' },
  footStyles: { fillColor: [255, 255, 255], textColor: NEGRO, fontStyle: 'bold' },
};

function textoGrupo(g: ResumenGrupo, p: PackingListDetalle, idioma: IdiomaPackingList): string {
  const emb = ETIQUETA_EMBALAJE[p.tipoEmbalaje];
  const unidades = g.bultos === 1 ? emb[idioma] : emb[idioma === 'en' ? 'enPlural' : 'esPlural'];
  const color = g.color ? ` (${nombreColor(g.color, idioma)})` : '';
  const encabezado = [etiquetaLote(g.lote, idioma), descripcionDe(p, idioma)].filter(Boolean).join('  ');
  const detalle = `${g.bultos} ${unidades}${color}`;
  return encabezado ? `${sanitizarPdf(encabezado)}\n${detalle}` : detalle;
}

function dibujarResumen(doc: Doc, autoTable: AutoTable, p: PackingListDetalle, idioma: IdiomaPackingList, y: number): number {
  const t = TEXTOS[idioma];
  const totales = calcularTotales(filasDe(p));
  const grupos = resumirPorLote(filasDe(p), p.esPcb);
  autoTable(doc, {
    ...ESTILO_TABLA,
    startY: y,
    head: [[t.item, t.descripcion, t.pesoNeto, t.unidad]],
    body: grupos.map((g, i) => [String(i + 1), textoGrupo(g, p, idioma), formatearPeso(g.pesoNeto), UNIDAD]),
    foot: [[
      '',
      `${t.total} ${totales.bultos} ${NOMBRE_BULTO[p.tipoEmbalaje][idioma]}`,
      `${t.totalKg} ${formatearPeso(totales.pesoNeto)}`,
      '',
    ]],
    showFoot: 'lastPage',
    columnStyles: { 0: { halign: 'center', cellWidth: 40 }, 2: { halign: 'right', cellWidth: 110 }, 3: { halign: 'center', cellWidth: 50 } },
  });
  return doc.lastAutoTable.finalY as number;
}

function dibujarObservaciones(doc: Doc, y: number, idioma: IdiomaPackingList, texto: string): void {
  if (!texto) return;
  const ancho = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold').setFontSize(9).text(TEXTOS[idioma].observaciones, MARGEN, y + 22);
  doc.setFont('helvetica', 'normal');
  doc.text(doc.splitTextToSize(sanitizarPdf(texto), ancho - MARGEN * 2), MARGEN, y + 36);
}

function dibujarDetalle(doc: Doc, autoTable: AutoTable, p: PackingListDetalle, idioma: IdiomaPackingList, y: number): void {
  const t = TEXTOS[idioma];
  const conPaleta = p.tipoEmbalaje !== 'paleta';
  const totales = calcularTotales(filasDe(p));
  const descGeneral = descripcionDe(p, idioma);
  const descripcion = (i: PackingListDetalle['items'][number]) => {
    const partes = p.esPcb
      ? [etiquetaLote(i.lote, idioma), i.color ? `(${nombreColor(i.color, idioma)})` : '']
      : [descGeneral];
    return sanitizarPdf(partes.filter(Boolean).join('  '));
  };
  const columnas = [t.numeroBulto[p.tipoEmbalaje], t.descripcion, t.pesoBruto, ...(conPaleta ? [t.numeroPaleta] : []), t.pesoPaleta, t.pesoNeto, t.unidad];
  const fila = (i: PackingListDetalle['items'][number]) => [
    String(i.numero), descripcion(i), formatearPeso(i.pesoBruto),
    ...(conPaleta ? [i.numeroPaleta === null ? '' : String(i.numeroPaleta)] : []),
    formatearPeso(i.pesoPaleta), formatearPeso(i.pesoNeto), UNIDAD,
  ];
  autoTable(doc, {
    ...ESTILO_TABLA,
    startY: y,
    head: [columnas],
    body: p.items.map(fila),
    foot: [[
      t.totales, '', formatearPeso(totales.pesoBruto),
      ...(conPaleta ? [String(totales.bultos)] : []),
      formatearPeso(totales.pesoPaletas), formatearPeso(totales.pesoNeto), UNIDAD,
    ]],
    showFoot: 'lastPage',
    columnStyles: {
      0: { halign: 'center' }, 2: { halign: 'right' },
      ...(conPaleta ? { 3: { halign: 'center' }, 4: { halign: 'right' }, 5: { halign: 'right' } } : { 3: { halign: 'right' }, 4: { halign: 'right' } }),
      [conPaleta ? 6 : 5]: { halign: 'center' },
    },
  });
}

/** Genera el PDF del packing list en el idioma pedido. `empresa` = datos del encabezado de ese idioma. */
export async function descargarPackingListPDF(
  p: PackingListDetalle,
  idioma: IdiomaPackingList,
  empresa: EmpresaPackingList | undefined
): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const t = TEXTOS[idioma];
  const nombre = descripcionDe(p, idioma);

  let y = dibujarEncabezado(doc, p, empresa, idioma);
  y = dibujarTitulo(doc, y, [nombre, t.titulo].filter(Boolean).join(' '));
  y = dibujarResumen(doc, autoTable, p, idioma, y);
  dibujarObservaciones(doc, y, idioma, observacionesDe(p, idioma));

  doc.addPage();
  y = dibujarEncabezado(doc, p, empresa, idioma);
  y = dibujarTitulo(doc, y, [nombre, t.tituloDetalle].filter(Boolean).join(' - '));
  dibujarDetalle(doc, autoTable, p, idioma, y);

  pieSinConexionPdf(doc);
  descargarBlob(doc.output('blob') as Blob, nombreArchivoPackingList(p, idioma));
}
