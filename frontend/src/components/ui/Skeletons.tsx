/** CUÁNDO USARLOS: mientras llega un dato, para reservar el espacio y que la pantalla no salte. Un skeleton por forma
 *  (tarjeta de indicador, bloque genérico, tabla, gráfica). Todos llevan aria-busy y una etiqueta legible por lectores de pantalla. */
import { useEffect, useState } from 'react';

const BASE = 'animate-pulse rounded-xl border border-border bg-surface-alt';

export interface SkeletonBloqueProps {
  /** Clase de alto de Tailwind (h-40, h-64...). */
  alto?: string;
  /** Añade el margen inferior estándar de un bloque (mb-8). */
  conMargen?: boolean;
  etiqueta?: string;
}

/** Rectángulo genérico para un bloque que está cargando. */
export function SkeletonBloque({ alto = 'h-40', conMargen = false, etiqueta = 'Cargando' }: SkeletonBloqueProps) {
  return <div className={`${conMargen ? 'mb-8 ' : ''}${alto} ${BASE}`} aria-busy="true" aria-label={etiqueta} />;
}

/** Una tarjeta de indicador cargando. */
export function SkeletonTarjeta() {
  return <div className={`h-36 ${BASE}`} aria-hidden="true" />;
}

/** La grilla de indicadores cargando (4 tarjetas, mismas columnas que GrillaKpis). */
export function SkeletonKpis({ cantidad = 4 }: { cantidad?: number }) {
  return (
    <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Cargando indicadores">
      {Array.from({ length: cantidad }, (_, i) => <SkeletonTarjeta key={i} />)}
    </div>
  );
}

/** Una tabla cargando: encabezado y `filas` renglones. */
export function SkeletonTabla({ filas = 6, columnas = 4 }: { filas?: number; columnas?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface" aria-busy="true" aria-label="Cargando tabla">
      <div className="h-9 animate-pulse bg-surface-alt" />
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="flex gap-4 border-t border-border px-3 py-3">
          {Array.from({ length: columnas }, (_, j) => (
            <div key={j} className={`h-3 animate-pulse rounded bg-surface-hover ${j === 0 ? 'w-1/3' : 'flex-1'}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Una gráfica cargando. */
export function SkeletonGrafica({ alto = 'h-56' }: { alto?: string }) {
  return <div className={`${alto} ${BASE}`} aria-busy="true" aria-label="Cargando gráfica" />;
}

/** Pasado este tiempo cargando, el skeleton explica por qué tarda (el servidor puede estar arrancando). */
export const MS_AVISO_CARGA_LENTA = 3000;

export interface SkeletonConAvisoProps extends SkeletonBloqueProps {
  /** Qué se está cargando, en minúsculas y con artículo: 'la lista de cambistas'. */
  queCarga: string;
}

/** SkeletonBloque que, si la carga pasa de unos segundos, avisa de que sigue en marcha y por qué puede tardar. */
export function SkeletonConAviso({ queCarga, alto, conMargen, etiqueta }: SkeletonConAvisoProps) {
  const [lento, setLento] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLento(true), MS_AVISO_CARGA_LENTA);
    return () => clearTimeout(t);
  }, []);
  return (
    <div>
      <SkeletonBloque alto={alto} conMargen={conMargen} etiqueta={etiqueta ?? `Cargando ${queCarga}`} />
      <p role="status" className="mt-2 text-xs text-text-muted">
        {lento
          ? `Sigue cargando ${queCarga}. Si el sistema estuvo un rato sin uso, la primera carga puede tardar unos segundos más.`
          : `Cargando ${queCarga}…`}
      </p>
    </div>
  );
}
