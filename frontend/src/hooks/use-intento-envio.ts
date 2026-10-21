import { useCallback, useRef } from 'react';
import { resolverIntento, type IntentoEnvio } from '../lib/intento-envio';

export interface ControlEnvio {
  /** Clave del envío para estos datos (misma huella = misma clave). Llamar al enviar, no al renderizar. */
  idPara: (huella: string) => string;
  /** Descarta la clave actual (tras un éxito): el próximo envío será otra operación. */
  renovar: () => void;
  /** Marca un envío en curso; devuelve false si ya hay uno (protección inmediata contra el doble clic). */
  iniciar: () => boolean;
  /** Libera la marca de envío en curso (siempre, en un finally). */
  terminar: () => void;
}

/** Idempotencia y anti doble clic para un formulario que envía una operación al servidor. */
export function useIntentoEnvio(): ControlEnvio {
  const intento = useRef<IntentoEnvio | null>(null);
  const enCurso = useRef(false);
  const idPara = useCallback((huella: string) => {
    intento.current = resolverIntento(intento.current, huella);
    return intento.current.id;
  }, []);
  const renovar = useCallback(() => { intento.current = null; }, []);
  const iniciar = useCallback(() => {
    if (enCurso.current) return false;
    enCurso.current = true;
    return true;
  }, []);
  const terminar = useCallback(() => { enCurso.current = false; }, []);
  return { idPara, renovar, iniciar, terminar };
}
