import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { DestinoVecino } from '../lib/navegacion-documentos';


interface Props {
  /** Nombre del documento en singular para los textos («ticket», «factura», «pago»…). */
  nombre: string;
  anterior: DestinoVecino | null;
  siguiente: DestinoVecino | null;
  posicion: number | null;
  total: number;
}

const ENLACE = 'inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';
const ENLACE_INACTIVO = 'inline-flex cursor-not-allowed items-center gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-text-muted opacity-50';

/** Botones «Anterior» / «Siguiente» para saltar entre documentos desde el detalle, sin volver a la lista. No se imprime. */
function NavegacionDocumentos({ nombre, anterior, siguiente, posicion, total }: Props) {
  if (posicion === null || total < 2) return null;
  return (
    <nav aria-label={`Navegar entre ${nombre}s`} className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
      {anterior
        ? <Link to={anterior.to} replace state={anterior.state} className={ENLACE} title={`Ir al ${nombre} anterior (el creado justo antes)`}><ChevronLeft size={16} aria-hidden="true" /> Anterior</Link>
        : <span className={ENLACE_INACTIVO} aria-disabled="true"><ChevronLeft size={16} aria-hidden="true" /> Anterior</span>}
      <span className="text-xs text-text-secondary">{posicion} de {total}</span>
      {siguiente
        ? <Link to={siguiente.to} replace state={siguiente.state} className={ENLACE} title={`Ir al ${nombre} siguiente (el creado justo después)`}>Siguiente <ChevronRight size={16} aria-hidden="true" /></Link>
        : <span className={ENLACE_INACTIVO} aria-disabled="true">Siguiente <ChevronRight size={16} aria-hidden="true" /></span>}
    </nav>
  );
}

export default NavegacionDocumentos;
