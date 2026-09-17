import type { NotaAjusteDetalle } from './nota-ajuste-service';
import type { NotaAjusteClienteDetalle } from './nota-ajuste-cliente-service';
import { fmt, encabezadoMarca, tituloConBadge, subtitulo, filaEncabezado, type Badge } from './pdf-documento';

type Nota = NotaAjusteDetalle | NotaAjusteClienteDetalle;

function nombreEntidad(nota: Nota): string {
  return 'nombreProveedor' in nota ? nota.nombreProveedor : nota.nombreCliente;
}

/** El preview siempre muestra el badge de tipo (con el título completo como
 *  texto, ej. "Nota de crédito") y, además, uno de anulada/pagada si
 *  aplica — no son mutuamente excluyentes. El texto del primero no calza
 *  con ninguna clave de BADGE_COLOR (son las palabras sueltas "crédito"/
 *  "débito"), por eso lleva color explícito. */
function badges(nota: Nota, esProveedor: boolean, titulo: string): Badge[] {
  const lista: Badge[] = [{ texto: titulo, color: nota.tipo === 'credito' ? [29, 78, 175] : [109, 40, 178] }];
  if (nota.anulada) lista.push({ texto: 'Anulada' });
  else if (nota.pagada) lista.push({ texto: esProveedor ? 'Pagada' : 'Cobrada' });
  return lista;
}

/** Documento puramente monetario: solo filas de encabezado + monto, sin
 *  tabla — esquinas cuadradas (no aplica la caja redondeada de pesaje). */
export async function descargarNotaPDF(nota: Nota, esProveedor: boolean): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  encabezadoMarca(doc);

  const titulo = nota.tipo === 'credito' ? 'Nota de crédito' : 'Nota de débito';
  let y = 56 + 52;
  tituloConBadge(doc, y, titulo, badges(nota, esProveedor, titulo));

  y += 16;
  subtitulo(doc, y, `Ref. ${nota.codigo ?? `N.º ${nota.id.slice(0, 8)}`}  ·  ${nota.fecha.slice(0, 10)}`);

  y += 26;
  y = filaEncabezado(doc, y, esProveedor ? 'Proveedor' : 'Cliente', nombreEntidad(nota));
  y = filaEncabezado(doc, y, 'Fecha', nota.fecha.slice(0, 10));
  y = filaEncabezado(doc, y, 'Correlativo', nota.codigo ?? '—');
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
