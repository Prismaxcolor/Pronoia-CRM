import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useSoloEnLinea } from '../../lib/offline/solo-en-linea';

/** CUÁNDO USARLO: cuando una lista, tabla o gráfica no tiene datos. Nunca dejes un hueco mudo: explica POR QUÉ está
 *  vacío y ofrece la acción que lo resuelve (enlace o botón). 'marca' es para funciones aún no construidas ("Próximamente"). */
export interface AccionVacio {
  etiqueta: string;
  /** Ruta interna (enlace). */
  to?: string;
  onClick?: () => void;
  /** La acción escribe en el servidor: sin conexión el botón se deshabilita (con su explicación). */
  soloEnLinea?: boolean;
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
  const enLinea = useSoloEnLinea();
  const bloqueo = accion?.soloEnLinea ? enLinea.props() : { disabled: false, title: undefined };
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
        : <button type="button" onClick={accion.onClick} disabled={bloqueo.disabled} title={bloqueo.title} className={`${CLASE_ACCION} disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline`}>{accion.etiqueta} →</button>)}
    </div>
  );
}

export default EstadoVacio;
