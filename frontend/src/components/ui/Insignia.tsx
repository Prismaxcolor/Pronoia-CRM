import type { ReactNode } from 'react';
import { ESTILOS_TONO, infoEstado, type Tono } from '../../lib/paleta';

/** CUÁNDO USARLA: etiqueta corta de estado o clasificación dentro de una fila o tarjeta ("Pagada", "Compra", "Limpio").
 *  El texto siempre dice el estado (el color no va solo). Tonos: neutral, marca, exito, aviso, peligro (rojo: solo
 *  para algo realmente urgente o fallido), info. Para estados de documentos usa <InsigniaEstado estado="pagada"/>. */
export interface InsigniaProps {
  tono?: Tono;
  /** 'cuadrada' = chica para filas densas; 'pastilla' = redondeada. */
  forma?: 'cuadrada' | 'pastilla';
  icono?: ReactNode;
  title?: string;
  children: ReactNode;
}

function Insignia({ tono = 'neutral', forma = 'pastilla', icono, title, children }: InsigniaProps) {
  const base = forma === 'cuadrada'
    ? 'rounded px-1.5 py-0.5 text-[10px] font-medium'
    : 'rounded-full px-2 py-0.5 text-xs font-medium';
  return (
    <span title={title} className={`inline-flex items-center gap-1 ${base} ${ESTILOS_TONO[tono].insignia}`}>
      {icono && <span aria-hidden="true" className="flex">{icono}</span>}
      {children}
    </span>
  );
}

/** Insignia de un estado de documento/pesaje (pagada, pendiente, anulada, borrador, emitida, bruto, completo). */
export function InsigniaEstado({ estado, forma }: { estado: string | null | undefined; forma?: InsigniaProps['forma'] }) {
  const info = infoEstado(estado);
  return <Insignia tono={info.tono} forma={forma}>{info.etiqueta}</Insignia>;
}

export default Insignia;
