import type { ReactNode } from 'react';

/** CUÁNDO USARLA: contenedor de TarjetaKpi. Móvil primero: 1 columna en móvil, 2 en tablet, 4 en escritorio ancho.
 *  Regla de estilo: máximo 4 indicadores por fila (si hay más, agrúpalos en otra GrillaKpis bajo otro Bloque).
 *  Envuélvela en <section aria-label="Indicadores principales"> si la pantalla no tiene otro rótulo. */
function GrillaKpis({ children }: { children: ReactNode }) {
  return <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}

export default GrillaKpis;
