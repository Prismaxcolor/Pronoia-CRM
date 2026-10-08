import type { DetalleMovimiento } from '../../services/banca-service';
import { nombreArchivoDocumento } from '../../lib/nombre-archivo';
import { formatearFecha } from '../../lib/formato';
import { formatearFechaHora, leyendaRegistro } from '../../lib/fecha-negocio';
import { montoUsdDe } from '../../lib/cochinito-kpis';
import {
  entregarPdf, fmt, sanitizarPdf, encabezadoMarca, tituloConBadge, subtitulo, filaEncabezado, pieRegistro,
  type ArchivoPdf, type ModoPdf,
} from '../../services/pdf-documento';
import {
  ETIQUETA_SUBTIPO_MOVIMIENTO, ETIQUETA_TIPO_MOVIMIENTO, numeroMovimiento, tasaDe,
} from './detalle-movimiento';

const COLOR_ANULADO: [number, number, number] = [185, 28, 28];
const MARGEN_IZQUIERDO = 56;
const MARGEN_DERECHO = 539;

/** Texto "tipo · subtipo" del movimiento. */
function textoTipo(d: DetalleMovimiento): string {
  const { tipo, subtipo } = d.movimiento;
  return subtipo ? `${ETIQUETA_TIPO_MOVIMIENTO[tipo]} · ${ETIQUETA_SUBTIPO_MOVIMIENTO[subtipo]}` : ETIQUETA_TIPO_MOVIMIENTO[tipo];
}

/** Filas etiqueta/valor del encabezado; las vacías se omiten. */
function filasDelMovimiento(d: DetalleMovimiento): Array<[string, string]> {
  const m = d.movimiento;
  const tasa = tasaDe(m);
  const usd = montoUsdDe(m);
  const banca = d.bancaDestinoNombre ? `${d.bancaOrigenNombre ?? '—'} → ${d.bancaDestinoNombre}` : d.bancaOrigenNombre ?? '—';
  const tercero = d.proveedorNombre ?? d.clienteNombre;
  const filas: Array<[string, string | null]> = [
    ['Tipo', textoTipo(d)],
    ['Fecha', formatearFecha(m.fecha)],
    ['Banca', banca],
    ['Proveedor / cliente', tercero],
    ['Descripción', m.descripcion || null],
    ['Referencia', m.referencia || null],
    ['Tasa', tasa == null ? null : `${fmt(tasa)} Bs por USD`],
    ['Equivalente en USD', usd == null || m.moneda === 'USD' ? null : `USD ${fmt(usd)}`],
    ['Recibe la banca destino', m.montoDestino == null ? null : fmt(m.montoDestino)],
  ];
  return filas.filter((f): f is [string, string] => f[1] != null);
}

/** Comprobante de un movimiento de Wallet: mismas filas de encabezado que los demás documentos, monto grande al pie. */
export async function descargarMovimientoPDF(d: DetalleMovimiento, modo: ModoPdf = 'descargar'): Promise<ArchivoPdf | undefined> {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const m = d.movimiento;
  const numero = numeroMovimiento(m);

  encabezadoMarca(doc);
  let y = 56 + 52;
  tituloConBadge(doc, y, `Movimiento ${numero}`, m.anulado ? { texto: 'Anulado', color: COLOR_ANULADO } : null);
  y += 16;
  subtitulo(doc, y, formatearFecha(m.fecha));
  y += 26;
  for (const [etiqueta, valor] of filasDelMovimiento(d)) y = filaEncabezado(doc, y, etiqueta, valor);

  if (m.anulado) {
    const quien = d.anuladoPorNombre ? ` por ${d.anuladoPorNombre}` : '';
    const cuando = m.anuladoEn ? ` el ${formatearFechaHora(m.anuladoEn)}` : '';
    y = filaEncabezado(doc, y, 'Anulado', `${m.anuladoMotivo ? `${m.anuladoMotivo}. ` : ''}Anulado${quien}${cuando}`);
  }

  y += 14;
  doc.setDrawColor(120).setLineWidth(1.5).line(MARGEN_IZQUIERDO, y, MARGEN_DERECHO, y);
  y += 24;
  doc.setFontSize(20).setFont('helvetica', 'bold').setTextColor(0).text('Monto', MARGEN_IZQUIERDO, y);
  doc.text(sanitizarPdf(`${m.moneda} ${fmt(m.monto)}`), MARGEN_DERECHO, y, { align: 'right' });

  pieRegistro(doc, [leyendaRegistro(d.registradoPorNombre, m.creadoEn)]);
  const nombre = nombreArchivoDocumento({ prefijo: 'Movimiento', codigo: numero === '—' ? null : numero, entidad: d.proveedorNombre ?? d.clienteNombre ?? d.bancaOrigenNombre });
  return entregarPdf(doc, nombre, modo);
}
