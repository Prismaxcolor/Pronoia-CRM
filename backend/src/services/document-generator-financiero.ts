import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { nombreArchivoDocumento, slugArchivo } from '../utils/nombre-archivo.js';
import { encabezado, fmt, pieRegistroPdf, sanitizarPdf } from './document-generator.js';
import type { PagoDetalle } from './pago-detalle-service.js';
import type { EstadoCuentaPortal } from './portal-estado-cuenta.js';
import { totalesEstadoCuenta } from '../utils/estado-cuenta-totales.js';
import { formatearFechaHora } from '../utils/fecha-negocio.js';

// PDFs de los documentos financieros que se mandan por Telegram al proveedor/cliente:
// notas de crédito/débito, comprobantes de pago/cobro/cruce y estado de cuenta.
// Mismo estilo visual que ticket/factura de document-generator.ts. Regla de contenido:
// es un documento EXTERNO, así que nunca lleva el usuario interno que lo registró
// ("Registrado por") ni ids internos.

/** Lo mínimo de una nota (proveedor o cliente) que necesita el PDF. */
export interface NotaParaPdf {
  id: string;
  codigo: string | null;
  tipo: 'credito' | 'debito';
  monto: number;
  motivo: string;
  anulada: boolean;
  fecha: string;
  /** Instante en que se registró (timestamptz); opcional. */
  registradoEn?: string | null;
  anuladaAt: string | null;
  anuladaMotivo: string | null;
  facturaAsociada: { id: string; codigo: string | null } | null;
}

function slug(texto: string): string {
  return slugArchivo(texto);
}

function escribirFilas(doc: jsPDF, y: number, filas: Array<[string, string]>): number {
  let cursor = y;
  doc.setFontSize(11);
  for (const [k, v] of filas) {
    const lineas = doc.splitTextToSize(sanitizarPdf(v), 289);
    doc.setFont('helvetica', 'bold').text(sanitizarPdf(k), 56, cursor);
    doc.setFont('helvetica', 'normal').text(lineas, 250, cursor);
    cursor += 20 + (lineas.length - 1) * 13;
  }
  return cursor;
}

export function nombreArchivoNota(nota: NotaParaPdf, nombreEntidad?: string | null): string {
  return nombreArchivoDocumento({
    prefijo: nota.tipo === 'credito' ? 'Nota-credito' : 'Nota-debito',
    codigo: nota.codigo ?? nota.id.slice(0, 8),
    entidad: nombreEntidad,
  });
}

export function generarNotaPdf(nota: NotaParaPdf, nombreEntidad: string, esProveedor: boolean): Buffer {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const titulo = nota.tipo === 'credito' ? 'Nota de crédito' : 'Nota de débito';
  let y = encabezado(doc, nota.anulada ? `${titulo} (ANULADA)` : titulo);

  y += 20;
  doc.setFontSize(10).setFont('helvetica', 'normal');
  doc.text(nota.codigo ?? `N.º ${nota.id.slice(0, 8)}`, 56, y);
  doc.text(`Fecha: ${nota.fecha.slice(0, 10)}`, 250, y);
  doc.text(`Estado: ${nota.anulada ? 'anulada' : 'vigente'}`, 420, y);

  y += 30;
  const filas: Array<[string, string]> = [[esProveedor ? 'Proveedor' : 'Cliente', nombreEntidad]];
  if (nota.facturaAsociada) {
    filas.push(['Factura asociada', nota.facturaAsociada.codigo ?? `N.º ${nota.facturaAsociada.id.slice(0, 8)}`]);
  }
    if (nota.anulada) {
    if (nota.anuladaAt) filas.push(['Anulada el', formatearFechaHora(nota.anuladaAt)]);
  }
  y = escribirFilas(doc, y, filas);

  y += 10;
  doc.setDrawColor(0).setLineWidth(1).line(56, y, 539, y);
  y += 28;
  doc.setFontSize(16).setFont('helvetica', 'bold').text('Monto', 56, y);
  doc.text(fmt(nota.monto), 539, y, { align: 'right' });

  const leyenda = nota.anulada
    ? 'Esta nota fue anulada y ya no afecta el saldo.'
    : nota.tipo === 'credito'
      ? `Resta del saldo que ${esProveedor ? 'le debemos al proveedor' : 'nos debe el cliente'}.`
      : `Suma al saldo que ${esProveedor ? 'le debemos al proveedor' : 'nos debe el cliente'}.`;
  y += 22;
  doc.setFontSize(9).setFont('helvetica', 'normal').text(leyenda, 56, y);
  if (nota.registradoEn) pieRegistroPdf(doc, y + 4, [`Registrada el ${formatearFechaHora(nota.registradoEn)}`]);

  return Buffer.from(doc.output('arraybuffer'));
}

const ETIQUETA_ITEM: Record<string, string> = {
  factura: 'Factura',
  nota_debito: 'Nota de débito',
  nota_credito: 'Nota de crédito',
  adelanto: 'Adelanto',
};

export function nombreArchivoPago(pago: PagoDetalle): string {
  const esCruce = pago.codigoCruce != null;
  const prefijo = esCruce ? 'cruce' : pago.entidadTipo === 'proveedor' ? 'pago' : 'cobro';
  const ref = pago.codigoPago ?? pago.codigoAdelanto ?? pago.codigoCruce ?? pago.grupoId.slice(0, 8);
  return nombreArchivoDocumento({ prefijo: prefijo[0].toUpperCase() + prefijo.slice(1), codigo: ref, entidad: pago.nombreEntidad });
}

/** Filas del resumen (total de las facturas, adelantos / N/C / N/D, saldo pendiente) bajo el desglose. */
function filasResumenPdf(doc: jsPDF, y: number, filas: PagoDetalle['resumen']): number {
  let cursor = y;
  for (const f of filas) {
    doc.setFontSize(10).setFont('helvetica', f.clave === 'saldoPendiente' ? 'bold' : 'normal');
    doc.text(`${f.signo ? `${f.signo} ` : ''}${f.etiqueta}`, 56, cursor);
    doc.text(`${f.signo === '-' ? '-' : ''}$${fmt(f.montoUsd)}`, 539, cursor, { align: 'right' });
    cursor += 15;
  }
  return cursor + 6;
}

/** Comprobante de pago (proveedor), cobro (cliente) o cruce sin movimiento de dinero. */
export function generarPagoPdf(pago: PagoDetalle): Buffer {
  const esProveedor = pago.entidadTipo === 'proveedor';
  const esCruce = pago.codigoCruce != null;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let y = encabezado(doc, esCruce ? 'Comprobante de cruce' : esProveedor ? 'Comprobante de pago' : 'Comprobante de cobro');

  y += 20;
  doc.setFontSize(10).setFont('helvetica', 'normal');
  const codigos = [pago.codigoPago, pago.codigoAdelanto, pago.codigoCruce].filter((c): c is string => !!c);
  doc.text(codigos.join(' / ') || `N.º ${pago.grupoId.slice(0, 8)}`, 56, y);
  doc.text(`Fecha: ${pago.fecha}`, 330, y);

  y += 30;
  const filas: Array<[string, string]> = [[esProveedor ? 'Proveedor' : 'Cliente', pago.nombreEntidad]];
  if (pago.items.length === 0 && pago.descripcion) filas.push(['Descripción', pago.descripcion]);
  y = escribirFilas(doc, y, filas);

  y += 6;
  if (pago.items.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [['Código', 'Tipo', 'Monto (USD)']],
      body: pago.items.map(it => [
        sanitizarPdf(it.codigo ?? '—'),
        ETIQUETA_ITEM[it.tipo] ?? it.tipo,
        `${it.tipo === 'nota_credito' || it.tipo === 'adelanto' ? '-' : ''}${fmt(it.montoUsd)}`,
      ]),
      margin: { left: 56, right: 56 },
      styles: { font: 'helvetica', fontSize: 10, cellPadding: 6 },
      headStyles: { fillColor: false, textColor: 0, lineWidth: 0.5, fontStyle: 'bold' },
      columnStyles: { 2: { halign: 'right' } },
      theme: 'grid',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 20;
    y = filasResumenPdf(doc, y, pago.resumen.filter(f => f.clave !== 'pagado'));
  }

  if (esCruce) {
    doc.setFontSize(10).setFont('helvetica', 'normal').text('Cruce sin movimiento de dinero: no se usó banca ni método de pago.', 56, y);
    y += 14;
  } else {
    autoTable(doc, {
      startY: y,
      head: [['Banca', 'Monto', 'Referencia']],
      body: pago.bancas.map(b => [sanitizarPdf(b.bancaNombre ?? '—'), `${fmt(b.monto)} ${b.moneda}`, sanitizarPdf(b.referencia ?? '—')]),
      margin: { left: 56, right: 56 },
      styles: { font: 'helvetica', fontSize: 10, cellPadding: 6 },
      headStyles: { fillColor: false, textColor: 0, lineWidth: 0.5, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right' } },
      theme: 'grid',
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY;
  }

  y += 26;
  doc.setDrawColor(0).setLineWidth(1).line(56, y, 539, y);
  y += 24;
  doc.setFontSize(14).setFont('helvetica', 'bold').text(pago.items.length > 0 ? 'Pagado' : 'Total', 56, y);
  doc.text(`$${fmt(pago.totalUsd)}`, 539, y, { align: 'right' });
  if (pago.registradoEn) pieRegistroPdf(doc, y + 6, [`Registrado el ${formatearFechaHora(pago.registradoEn)}`]);

  return Buffer.from(doc.output('arraybuffer'));
}

const ETIQUETA_TIPO_EC: Record<string, string> = {
  factura: 'Factura',
  pago: 'Pago',
  adelanto: 'Adelanto',
  nota_credito: 'Nota de crédito',
  nota_debito: 'Nota de débito',
  cruce: 'Cruce',
};

export function nombreArchivoEstadoCuenta(estado: EstadoCuentaPortal, hoy: string): string {
  return `estado-de-cuenta-${slug(estado.entidad.nombre)}-${hoy}.pdf`;
}

/** Estado de cuenta en su versión externa (misma proyección que ve el portal: sin ids
 *  internos, sin notas anuladas ni motivos internos). */
export function generarEstadoCuentaPdf(estado: EstadoCuentaPortal, hoy: string): Buffer {
  const esProveedor = estado.entidad.tipo === 'proveedor';
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let y = encabezado(doc, 'Estado de cuenta');

  y += 20;
  doc.setFontSize(10).setFont('helvetica', 'normal').text(`Emitido: ${formatearFechaHora(new Date())}`, 56, y);

  y += 30;
  y = escribirFilas(doc, y, [[esProveedor ? 'Proveedor' : 'Cliente', estado.entidad.nombre]]);

  y += 6;
  autoTable(doc, {
    startY: y,
    head: [['Fecha', 'Tipo', 'Referencia', 'Cargo', 'Abono']],
    body: estado.entradas.map(e => [
      e.fecha.slice(0, 10),
      ETIQUETA_TIPO_EC[e.tipo] ?? e.tipo,
      sanitizarPdf(e.referencia ?? '—'),
      e.cargo > 0 ? fmt(e.cargo) : '',
      e.abono > 0 ? fmt(e.abono) : '',
    ]),
    margin: { left: 56, right: 56 },
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: false, textColor: 0, lineWidth: 0.5, fontStyle: 'bold' },
    columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' } },
    theme: 'grid',
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 26;

  // Totales de las MISMAS filas impresas arriba (función única compartida con pantalla y portal).
  const totales = totalesEstadoCuenta(estado.entradas);
  doc.setFontSize(10).setFont('helvetica', 'normal');
  doc.text(`Total cargos (${totales.filas} movimientos, USD)`, 56, y);
  doc.text(fmt(totales.totalCargos), 539, y, { align: 'right' });
  y += 16;
  doc.text('Total abonos', 56, y);
  doc.text(fmt(totales.totalAbonos), 539, y, { align: 'right' });
  y += 24;
  doc.setFontSize(14).setFont('helvetica', 'bold').text('Saldo final', 56, y);
  doc.text(fmt(totales.saldoFinal), 539, y, { align: 'right' });

  return Buffer.from(doc.output('arraybuffer'));
}
