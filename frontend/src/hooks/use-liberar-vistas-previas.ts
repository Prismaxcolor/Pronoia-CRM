import { useEffect, useRef } from 'react';
import { planLiberacionVistasPrevias, type FotoLocal } from '../lib/foto-picker';

/**
 * Libera con URL.revokeObjectURL las vistas previas de fotos nuevas apenas dejan de estar en las listas
 * (foto quitada, formulario guardado o reiniciado) y todas las que queden al desmontar el componente.
 * Úsalo donde vive el estado de las fotos y pasa todas las listas de ese componente.
 */
export function useLiberarVistasPrevias(...listas: ReadonlyArray<readonly FotoLocal[]>): void {
  const conocidas = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const plan = planLiberacionVistasPrevias(conocidas.current, listas.flat());
    plan.liberar.forEach(url => URL.revokeObjectURL(url));
    conocidas.current = plan.vigentes;
  });

  useEffect(() => () => {
    conocidas.current.forEach(url => URL.revokeObjectURL(url));
    conocidas.current = new Set();
  }, []);
}
