/** Acciones que escriben (pagar, cobrar, facturar, editar, anular, culminar toma…) solo con conexión.
 *  Uso: `const { deshabilitado, titulo } = useSoloEnLinea();` y en el botón
 *  `disabled={deshabilitado || otraCondicion} title={titulo}`; o `useSoloEnLinea().props(previo)`. */
import { useCallback } from 'react';
import { useEstadoConexion } from './conexion';
import { offlineHabilitado } from './sesion';
import { deshabilitarSiOffline, reglaSoloEnLinea, type ReglaSoloEnLinea } from './lectura-logica';

export interface SoloEnLinea extends ReglaSoloEnLinea {
  online: boolean;
  /** Props `disabled`/`title` ya combinadas con las del botón (conserva su título si hay conexión). */
  props: (deshabilitadoPrevio?: boolean, tituloPrevio?: string) => { disabled: boolean; title: string | undefined };
}

export function useSoloEnLinea(): SoloEnLinea {
  const { online: onlineReal } = useEstadoConexion();
  // Con el modo sin conexión apagado el sistema se comporta como hoy: no se deshabilita nada.
  const online = onlineReal || !offlineHabilitado();
  const props = useCallback<SoloEnLinea['props']>((deshabilitadoPrevio, tituloPrevio) => {
    const r = deshabilitarSiOffline(online, deshabilitadoPrevio, tituloPrevio);
    return { disabled: r.deshabilitado, title: r.titulo };
  }, [online]);
  return { ...reglaSoloEnLinea(online), online, props };
}
