import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { SEVERIDADES, type Severidad } from '../../lib/paleta';
import EstadoVacio from './EstadoVacio';
import { ordenarPorSeveridad } from './alertas-orden';

/** CUÁNDO USARLAS: avisos que piden atención (material estancado, merma alta, documento por vencer). Regla: el ROJO
 *  ('roja', "Urgente") es solo para alertas reales; lo demás es 'amarilla' (Atención) o 'info' (Aviso). Cada alerta lleva
 *  su palabra de severidad, el texto y, si existe, un enlace a la acción que la resuelve. Sin alertas: estado vacío positivo. */
const ICONO: Record<Severidad, typeof Info> = { roja: AlertOctagon, amarilla: AlertTriangle, info: Info };

export interface AlertaItemProps {
  severidad: Severidad;
  texto: string;
  /** Línea secundaria (material, valor, umbral). */
  detalle?: ReactNode;
  enlace?: { to: string; etiqueta: string };
}

export function AlertaItem({ severidad, texto, detalle, enlace }: AlertaItemProps) {
  const e = SEVERIDADES[severidad];
  const Icono = ICONO[severidad];
  return (
    <li className={`flex flex-wrap items-start gap-x-3 gap-y-1 rounded-lg border p-3 ${e.contenedor}`}>
      <span className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.insignia}`}>
        <Icono size={12} aria-hidden="true" /> {e.etiqueta}
      </span>
      <div className="min-w-0 flex-1 basis-full sm:basis-0">
        <p className="text-sm text-text-primary">{texto}</p>
        {detalle && <p className="mt-0.5 text-xs text-text-secondary">{detalle}</p>}
      </div>
      {enlace && <Link to={enlace.to} className="shrink-0 text-xs font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">{enlace.etiqueta} →</Link>}
    </li>
  );
}

export interface AlertaDatos extends AlertaItemProps {
  id: string;
}

export interface ListaAlertasProps {
  alertas: readonly AlertaDatos[];
  /** Conteos por severidad si vienen del servidor; si no, se cuentan de la lista. */
  conteo?: Partial<Record<Severidad, number>>;
  /** Contenido cuando no hay alertas (por defecto "Todo en orden"). */
  vacio?: ReactNode;
}

function ListaAlertas({ alertas, conteo, vacio }: ListaAlertasProps) {
  if (alertas.length === 0) {
    return <>{vacio ?? <EstadoVacio mensaje="Todo en orden: no hay alertas ahora" icono={<CheckCircle2 size={22} />} />}</>;
  }
  const n = (s: Severidad) => conteo?.[s] ?? alertas.filter(a => a.severidad === s).length;
  return (
    <>
      <ul className="mb-3 flex flex-wrap gap-2 text-xs" aria-label="Resumen de alertas">
        {(['roja', 'amarilla', 'info'] as const).filter(s => n(s) > 0).map(s => (
          <li key={s} className={`rounded-full px-2.5 py-0.5 font-semibold ${SEVERIDADES[s].insignia}`}>{n(s)} {SEVERIDADES[s].etiqueta.toLowerCase()}</li>
        ))}
      </ul>
      <ul className="space-y-2">{ordenarPorSeveridad(alertas).map(a => <AlertaItem key={a.id} {...a} />)}</ul>
    </>
  );
}

export default ListaAlertas;
