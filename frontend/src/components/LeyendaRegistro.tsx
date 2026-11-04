import { leyendaRegistro, leyendaUltimaEdicion } from '../lib/fecha-negocio';

interface Props {
  /** Nombre de quien registró el documento (null: se muestra "—"). */
  nombre: string | null | undefined;
  /** Instante de registro (timestamptz ISO). */
  instante: string | null | undefined;
  /** "Registrada" para documentos femeninos (factura, nota, transformación). Por defecto "Registrado". */
  verbo?: string;
  /** Línea intermedia opcional (p. ej. "Completado por Ana · 07/10/2026 14:05"). */
  extra?: string | null;
  /** Última edición, si existe. */
  edicion?: { nombre: string; en: string } | null;
  className?: string;
}

/** Leyenda "Registrado por <nombre> · dd/mm/aaaa hh:mm" (+ "Última edición por …") en hora de Caracas.
 *  Visible también al imprimir. */
function LeyendaRegistro({ nombre, instante, verbo, extra, edicion, className }: Props) {
  const ultima = leyendaUltimaEdicion(edicion?.nombre, edicion?.en);
  return (
    <div className={className ?? 'text-xs text-text-muted'}>
      <p>{leyendaRegistro(nombre, instante, verbo)}</p>
      {extra && <p>{extra}</p>}
      {ultima && <p>{ultima}</p>}
    </div>
  );
}

export default LeyendaRegistro;
