import type { NotaAjusteDetalle } from './nota-ajuste-service';
import type { NotaAjusteClienteDetalle } from './nota-ajuste-cliente-service';
import { fmt, encabezadoMarca, tituloConBadge, filaEncabezado } from './pdf-documento';

type Nota = NotaAjusteDetalle | NotaAjusteClienteDetalle;

function nombreEntidad(nota: Nota): string {
  return 'nombreProveedor' in nota ? nota.nombreProveedor : nota.nombreCliente;
}

function badgeTexto(nota: Nota, esProveedor: boolean): string {
  if (nota.anulada) return 'Anulada';
  if (nota.pagada) return esProveedor ? 'Pagada' : 'Cobrada';
  return nota.tipo === 'credito' ? 'Crédito' : 'Débito';
}

/** Documento puramente monetario: solo filas de encabezado + monto, sin
 *  tabla — esquinas cuadradas (no aplica la caja redondeada de pesaje). */
export async function descargarNotaPDF(nota: Nota, esProveedor: boolean): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  encabezadoMarca(doc);

  const titulo = nota.tipo === 'credito' ? 'Nota de crédito' : 'Nota de débito';
  let y = 56 + 52;
  tituloConBadge(doc, y, titulo, badgeTexto(nota, esProveedor));

  y += 22;
  y = filaEncabezado(doc, y, 'Ref.', `${nota.codigo ?? `N.º ${nota.id.slice(0, 8)}`}  ·  ${nota.fecha.slice(0, 10)}`);
  y = filaEncabezado(doc, y, esProveedor ? 'Proveedor' : 'Cliente', nombreEntidad(nota));
  if (nota.facturaAsociada) {
    y = filaEncabezado(doc, y, 'Factura asociada', nota.facturaAsociada.codigo ?? `N.º ${nota.facturaAsociada.id.slice(0, 8)}`);
  }
  y = filaEncabezado(doc, y, 'Motivo', nota.motivo);
  y = filaEncabezado(doc, y, 'Registrado por', nota.registradoPor ?? '—');

  y += 20;
  doc.setDrawColor(120).setLineWidth(1.5).line(56, y, 539, y);
  y += 30;
  doc.setFontSize(20).setFont('helvetica', 'bold').setTextColor(0).text('Monto', 56, y);
  doc.text(fmt(nota.monto), 539, y, { align: 'right' });

  const leyenda = nota.tipo === 'credito'
    ? `Resta del saldo que ${esProveedor ? 'le debemos al proveedor' : 'nos debe el cliente'}.`
    : `Suma al saldo que ${esProveedor ? 'le debemos al proveedor' : 'nos debe el cliente'}.`;
  y += 22;
  doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(130).text(leyenda, 56, y);

  const ref = (nota.codigo ?? nota.id.slice(0, 8)).replace(/\s+/g, '-').toLowerCase();
  doc.save(`nota-${nota.tipo}-${ref}.pdf`);
}
