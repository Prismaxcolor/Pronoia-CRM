import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** CUÁNDO USARLO: cuando una lista, tabla o gráfica no tiene datos. Nunca dejes un hueco mudo: explica POR QUÉ está
 *  vacío y ofrece la acción que lo resuelve (enlace o botón). 'marca' es para funciones aún no construidas ("Próximamente"). */
export interface AccionVacio {
  etiqueta: string;
  /** Ruta interna (enlace). */
  to?: string;
  onClick?: () => void;
}

export interface EstadoVacioProps {
  mensaje: string;
  descripcion?: string;
  icono?: ReactNode;
  accion?: AccionVacio;
  variante?: 'neutro' | 'marca';
}

const CLASE_ACCION = 'mt-2 inline-block text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800';

function EstadoVacio({ mensaje, descripcion, icono, accion, variante = 'neutro' }: EstadoVacioProps) {
  const marca = variante === 'marca';
  return (
    <div className={marca
      ? 'rounded-xl border border-dashed border-brand-300 bg-brand-50/60 px-4 py-6 text-center'
      : 'rounded-xl border border-dashed border-border-strong bg-surface px-4 py-8 text-center'}
    >
      {icono && <div className={`mx-auto flex justify-center ${marca ? 'mb-2 text-brand-600' : 'mb-2 text-text-muted'}`} aria-hidden="true">{icono}</div>}
      <p className={`text-sm text-text-primary ${marca ? 'font-medium' : ''}`}>{mensaje}</p>
      {descripcion && <p className={marca ? 'mt-1 text-xs text-text-secondary' : 'mx-auto mt-1 max-w-md text-xs text-text-secondary'}>{descripcion}</p>}
      {accion && (accion.to
        ? <Link to={accion.to} className={CLASE_ACCION}>{accion.etiqueta} →</Link>
        : <button type="button" onClick={accion.onClick} className={CLASE_ACCION}>{accion.etiqueta} →</button>)}
    </div>
  );
}

export default EstadoVacio;
