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
  ETIQUETA_SUBTIPO_MOVIMIENTO, ETIQUETA_TIPO_MOVIMIENTO, esTransferenciaEnProceso, etiquetaEstadoMesa, montoQueRecibeElDestino, montosTransferencia, numeroMovimiento, tasaDe, type MontosTransferencia,
} from './detalle-movimiento';
import { montoCobradoMesa, montoPendienteMesa } from './cobro-mesa';

const COLOR_ANULADO: [number, number, number] = [185, 28, 28];
const MARGEN_IZQUIERDO = 56;
const MARGEN_DERECHO = 539;

/** Texto "tipo · subtipo" del movimiento. */
function textoTipo(d: DetalleMovimiento): string {
  const { tipo, subtipo } = d.movimiento;
  return subtipo ? `${ETIQUETA_TIPO_MOVIMIENTO[tipo]} · ${ETIQUETA_SUBTIPO_MOVIMIENTO[subtipo]}` : ETIQUETA_TIPO_MOVIMIENTO[tipo];
}

/** Transferencia con mesa de cambio: cambista, estado, comisión y lo que recibe el destino. Un movimiento normal usa montoDestino. */
function filasMesa(d: DetalleMovimiento): Array<[string, string | null]> {
  const m = d.movimiento;
  if (m.mesaCambistaId == null) return [['Recibe la banca destino', m.montoDestino == null ? null : fmt(m.montoDestino)]];
  const recibe = montoQueRecibeElDestino(m);
  return [
    ['Mesa de cambio', d.cambistaNombre],
    ['Estado de la transferencia', m.anulado ? 'Anulada' : etiquetaEstadoMesa(m)],
    ['Comisión del cambio', m.mesaComision == null ? null : fmt(m.mesaComision)],
    [esTransferenciaEnProceso(m) ? 'Recibirá la banca destino al completar' : 'Recibe la banca destino', recibe == null ? null : fmt(recibe)],
    // Hasta que se cobre completa, lo que falta queda como pendiente por cobrar (el cambista nos debe); parcial muestra además lo ya cobrado.
    ...(esTransferenciaEnProceso(m)
      ? [
        ...(m.mesaEstado === 'parcial' ? [['Ya cobrado', fmt(montoCobradoMesa(m) ?? 0)]] : []),
        ['Pendiente por cobrar (el cambista nos debe)', fmt(montoPendienteMesa(m) ?? 0)],
      ] as Array<[string, string | null]>
      : []),
    ['Observación', m.mesaObservacion ?? null],
  ];
}

/** Filas etiqueta/valor del encabezado; las vacías se omiten. */
function filasDelMovimiento(d: DetalleMovimiento, categoria: string | null, montosBs: MontosTransferencia | null): Array<[string, string]> {
  const m = d.movimiento;
  const tasa = tasaDe(m);
  const usd = montosBs ? montosBs.usd : montoUsdDe(m);
  const banca = d.bancaDestinoNombre ? `${d.bancaOrigenNombre ?? '—'} → ${d.bancaDestinoNombre}` : d.bancaOrigenNombre ?? '—';
  const tercero = d.proveedorNombre ?? d.clienteNombre;
  const filas: Array<[string, string | null]> = [
    ['Tipo', textoTipo(d)],
    ['Fecha', formatearFecha(m.fecha)],
    ['Banca', banca],
    ['Proveedor / cliente', tercero],
    ['Categoría', categoria],
    ['Descripción', m.descripcion || null],
    ['Referencia', m.referencia || null],
    ['Tasa', tasa == null ? null : `${fmt(tasa)} Bs por USD`],
    ['Equivalente en USD', usd == null || (m.moneda === 'USD' && !montosBs) ? null : `USD ${fmt(usd)}`],
    ...filasMesa(d),
  ];
  return filas.filter((f): f is [string, string] => f[1] != null);
}

/** Comprobante de un movimiento de Wallet: mismas filas de encabezado que los demás documentos, monto grande al pie. */
export async function descargarMovimientoPDF(d: DetalleMovimiento, modo: ModoPdf = 'descargar', categoria: string | null = null, monedaDestino?: string): Promise<ArchivoPdf | undefined> {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const m = d.movimiento;
  const numero = numeroMovimiento(m);
  // Transferencia con una punta en Bs: mismo criterio que la pantalla (monto en Bs primero, equivalente en USD después).
  const montosBs = montosTransferencia(m, monedaDestino);

  encabezadoMarca(doc);
  let y = 56 + 52;
  tituloConBadge(doc, y, `Movimiento ${numero}`, m.anulado ? { texto: 'Anulado', color: COLOR_ANULADO } : null);
  y += 16;
  subtitulo(doc, y, formatearFecha(m.fecha));
  y += 26;
  for (const [etiqueta, valor] of filasDelMovimiento(d, categoria, montosBs)) y = filaEncabezado(doc, y, etiqueta, valor);

  if (m.anulado) {
    const quien = d.anuladoPorNombre ? ` por ${d.anuladoPorNombre}` : '';
    const cuando = m.anuladoEn ? ` el ${formatearFechaHora(m.anuladoEn)}` : '';
    y = filaEncabezado(doc, y, 'Anulado', `${m.anuladoMotivo ? `${m.anuladoMotivo}. ` : ''}Anulado${quien}${cuando}`);
  }

  y += 14;
  doc.setDrawColor(120).setLineWidth(1.5).line(MARGEN_IZQUIERDO, y, MARGEN_DERECHO, y);
  y += 24;
  doc.setFontSize(20).setFont('helvetica', 'bold').setTextColor(0).text('Monto', MARGEN_IZQUIERDO, y);
  doc.text(sanitizarPdf(montosBs ? `VES ${fmt(montosBs.bs)}` : `${m.moneda} ${fmt(m.monto)}`), MARGEN_DERECHO, y, { align: 'right' });

  pieRegistro(doc, [leyendaRegistro(d.registradoPorNombre, m.creadoEn)]);
  const nombre = nombreArchivoDocumento({ prefijo: 'Movimiento', codigo: numero === '—' ? null : numero, entidad: d.proveedorNombre ?? d.clienteNombre ?? d.bancaOrigenNombre });
  return entregarPdf(doc, nombre, modo);
}
