import { useSyncExternalStore } from 'react';
import {
  ESTADO_ACTUALIZADOR_INICIAL,
  leerEstadoActualizador,
  suscribirActualizador,
  type EstadoActualizador,
} from './actualizador-servicio';

/** Estado reactivo de la detección de versión remota y del procedimiento de actualización. */
export function useVersionRemota(): EstadoActualizador {
  return useSyncExternalStore(suscribirActualizador, leerEstadoActualizador, () => ESTADO_ACTUALIZADOR_INICIAL);
}
