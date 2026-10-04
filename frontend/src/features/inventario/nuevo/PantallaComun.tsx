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
    <span className="inline-flex items-center gap-1 text-text-muted" title="Tu usuario no tiene permiso para ver valores en dinero (USD)">
      <Lock size={12} aria-hidden="true" />
      <span className="text-xs font-medium">{corto ? 'Sin permiso' : 'Sin permiso para ver valores'}</span>
    </span>
  );
}

/** Rótulo de cifra derivada del nombre del material, con el "?" que lo explica. */
export function EtiquetaDerivada({ children, explicacion, rotulo = 'se deduce del nombre' }: { children: string; explicacion: string; rotulo?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {children}
      <span className="rounded bg-slate-100 px-1 text-[10px] font-medium uppercase tracking-wide text-slate-600">{rotulo}</span>
      <InfoTooltip etiqueta={`Qué significa: ${children}`}>{explicacion}</InfoTooltip>
    </span>
  );
}

export const EXPLICACION_LIMPIEZA = 'Limpio: ya no trae residuos y se puede vender. Sucio: trae residuos y hay que limpiarlo antes. Se toma del estado marcado en el producto; si no tiene, se deduce de si su nombre dice LIMPIO o SUCIO. Sin ninguna de las dos pistas queda «sin clasificar».';
export const EXPLICACION_BASURA = 'Recuperable: todavía tiene material aprovechable (productos BASURA BUENA y BASURA DE RECEPCION). Desecho: no se puede recuperar y va al vertedero (BASURA MALA y DESECHOS). Esto no es un dato guardado: se deduce del nombre del producto; los demás nombres quedan «sin clasificar».';
export const EXPLICACION_DIAS = 'Días que lleva en el galpón el material que hay hoy, contados desde la fecha en que entró hasta hoy. Es un estimado: el sistema no sabe de qué compra salió cada kilo vendido, así que supone que lo que queda es lo que entró más recientemente y promedia los días de esas entradas según sus kg. Por ejemplo: quedan 100 kg; entraron 60 kg hace 10 días y 80 kg hace 40 días → se cuentan 60 kg de hace 10 días y 40 kg de hace 40 días → (60×10 + 40×40) ÷ 100 = 22 días. Cuentan como entradas las compras, las salidas de transformaciones y los ajustes positivos de toma física. Los registros empiezan el 16-09-2026: los kg que ninguna entrada registrada explica no se cuentan. No cambia con el rango de fechas elegido arriba. Por defecto se avisa desde 60 días (atención) y desde 90 días (urgente).';
export const EXPLICACION_ETAPAS_BARRA = 'Reparte los kg de la categoría en tres etapas. Recibido: material que llegó y aún no se trabaja (incluye lotes de trabajo por procesar). En proceso: lotes ya procesados, lotes de exportación armados pero sin embalar y kg retirados para una transformación. Listo: kg embalados de lotes de exportación y material de venta nacional disponible.';
export const EXPLICACION_DIAS_TARJETA = 'Días promedio que llevan en el galpón los materiales y lotes de esta categoría que tienen stock hoy. Para cada uno se cuentan los días desde la fecha en que entró lo que queda (se supone que es lo último que entró) y luego se promedian por kg, así que lo que tiene más kilos pesa más. Es un estimado y no cuenta los kg sin entrada registrada. Por defecto se avisa desde 60 días (atención) y desde 90 días (urgente).';

/** Chip del filtro de categoría activo, con botón para quitarlo. */
export function ChipFiltro({ etiqueta, onQuitar }: { etiqueta: string; onQuitar: () => void }) {
  return <Chip onQuitar={onQuitar} etiquetaQuitar={`Quitar filtro ${etiqueta}`}>Filtrando: {etiqueta}</Chip>;
}
