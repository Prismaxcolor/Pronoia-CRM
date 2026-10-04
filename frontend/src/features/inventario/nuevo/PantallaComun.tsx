import { AlertTriangle, Lock, RefreshCw } from 'lucide-react';
import type { MetaPantalla } from '@shared/types/inventario-pantalla.js';
import { Chip, InfoTooltip, SkeletonBloque as SkeletonKit } from '../../../components/ui';

/** Piezas compartidas por los cuatro bloques pesados de la pantalla de inventario. */

export const SkeletonBloque = SkeletonKit;

/** Error de carga de un bloque (no tumba el resto de la pantalla). */
export function ErrorBloque({ mensaje, onReintentar }: { mensaje: string; onReintentar: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p className="font-medium">No se pudo cargar este bloque.</p>
      <p className="mt-0.5 text-xs">{mensaje}</p>
      <button type="button" onClick={onReintentar} className="mt-2 flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-red-100">
        <RefreshCw size={14} aria-hidden="true" /> Reintentar
      </button>
    </div>
  );
}

/** Aviso ámbar cuando el backend marca la respuesta como parcial: la cifra afectada no está completa. */
export function AvisosMeta({ meta }: { meta: Pick<MetaPantalla, 'parcial' | 'avisos'> }) {
  if (!meta.parcial && meta.avisos.length === 0) return null;
  return (
    <div role="status" className="mb-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div>
        {meta.parcial && <p className="font-medium">Algunas cifras de este bloque pueden estar incompletas.</p>}
        {meta.avisos.length > 0 && <ul className="list-disc pl-4">{meta.avisos.map(a => <li key={a}>{a}</li>)}</ul>}
      </div>
    </div>
  );
}

/** Valor que el usuario no puede ver (sin facturacion:ver). Con candado y texto: no depende solo del ícono. */
export function SinPermiso({ corto = false }: { corto?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-text-muted" title="Tu usuario no tiene permiso para ver valores en dinero">
      <Lock size={12} aria-hidden="true" />
      <span className="text-xs font-medium">{corto ? 'Sin permiso' : 'Sin permiso para ver valores'}</span>
    </span>
  );
}

/** Rótulo de cifra derivada del nombre del material, con el "?" que lo explica. */
export function EtiquetaDerivada({ children, explicacion, rotulo = 'derivado del nombre' }: { children: string; explicacion: string; rotulo?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {children}
      <span className="rounded bg-slate-100 px-1 text-[10px] font-medium uppercase tracking-wide text-slate-600">{rotulo}</span>
      <InfoTooltip etiqueta={`Qué significa: ${children}`}>{explicacion}</InfoTooltip>
    </span>
  );
}

export const EXPLICACION_LIMPIEZA = 'Sale del estado de limpieza definido en el producto; si el producto no lo tiene, se deduce del nombre (SUCIO o LIMPIO). Lo que no tiene ninguna pista queda sin clasificar.';
export const EXPLICACION_BASURA = 'No es un dato guardado: se deduce del nombre. BASURA BUENA y BASURA DE RECEPCION se cuentan como recuperable (aún tienen algo bueno); BASURA MALA y DESECHOS, como desecho (va al vertedero); el resto queda sin clasificar.';
export const EXPLICACION_DIAS = 'Estimado: el sistema no lleva capas FIFO. Se asume que el stock actual se formó con las entradas más recientes (compras, salidas de transformación, ajustes positivos) y se promedia por kg. Los datos empiezan el 16-09-2026: no se inventa antigüedad anterior.';

/** Chip del filtro de categoría activo, con botón para quitarlo. */
export function ChipFiltro({ etiqueta, onQuitar }: { etiqueta: string; onQuitar: () => void }) {
  return <Chip onQuitar={onQuitar} etiquetaQuitar={`Quitar filtro ${etiqueta}`}>Filtrando: {etiqueta}</Chip>;
}
