import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** CUÁNDO USARLO: acciones del encabezado de página o de un bloque. 'primario' (verde de marca, máx. uno por pantalla),
 *  'secundario' (borde). Con `to` es un enlace; con `onClick` un botón. */
export interface BotonAccionProps {
  variante?: 'primario' | 'secundario';
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
  icono?: ReactNode;
  children: ReactNode;
}

const BASE = 'flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-50';
const VARIANTES = {
  primario: 'bg-brand-600 text-white hover:bg-brand-700',
  secundario: 'border border-border bg-surface text-text-primary hover:bg-surface-hover',
} as const;

function BotonAccion({ variante = 'primario', to, onClick, disabled, icono, children }: BotonAccionProps) {
  const clase = `${BASE} ${VARIANTES[variante]}`;
  const contenido = (<>{icono && <span aria-hidden="true" className="flex">{icono}</span>}{children}</>);
  if (to) return <Link to={to} className={clase}>{contenido}</Link>;
  return <button type="button" onClick={onClick} disabled={disabled} className={clase}>{contenido}</button>;
}

export default BotonAccion;
