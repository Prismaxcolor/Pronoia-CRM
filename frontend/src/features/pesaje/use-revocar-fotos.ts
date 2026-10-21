import { useEffect, useRef } from 'react';
import type { FotoLocal } from '../../lib/foto-picker';
import { revocarFotos } from './fotos-preview';

/** Libera las vistas previas (URL.createObjectURL) de las fotos que sigan en `fotos`
 *  cuando el componente se desmonta. Las que se quitan antes se liberan al quitarlas
 *  (ver `revocarFoto`). Úsalo donde vive el estado de las fotos: si el estado sobrevive
 *  al componente (borrador en un Provider), úsalo en el Provider, no en la pantalla. */
export function useRevocarFotosAlDesmontar(fotos: readonly FotoLocal[]): void {
  const ultimas = useRef<readonly FotoLocal[]>(fotos);
  useEffect(() => {
    ultimas.current = fotos;
  });
  useEffect(() => () => revocarFotos(ultimas.current), []);
}
