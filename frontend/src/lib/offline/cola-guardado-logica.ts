/** Decisiones puras del guardado con respaldo sin conexión. Principio: ante cualquier duda se guarda
 *  en línea, como siempre; el encolado solo se usa cuando de verdad no hay red. */

export interface EntornoGuardado {
  /** Interruptor OFFLINE_ACTIVO del servidor (apagado = guardado normal). */
  offlineHabilitado: boolean;
  online: boolean;
  /** IndexedDB disponible para guardar la cola de forma durable. */
  colaDisponible: boolean;
}

/** 'cola': guardar primero en el teléfono (fotos locales). 'enlinea': subir fotos y enviar ya. */
export function decidirModoGuardado(e: EntornoGuardado): 'cola' | 'enlinea' {
  return e.offlineHabilitado && e.colaDisponible && !e.online ? 'cola' : 'enlinea';
}

/** Tras un envío en línea fallido: solo se encola si el fallo fue de red (el servidor no contestó). */
export function puedeEncolarTrasFallo(e: Omit<EntornoGuardado, 'online'> & { errorDeRed: boolean }): boolean {
  return e.offlineHabilitado && e.colaDisponible && e.errorDeRed;
}

export function mensajeGuardadoEnTelefono(codigoProvisional: string | undefined): string {
  const codigo = codigoProvisional ? `${codigoProvisional}: ` : '';
  return `${codigo}Guardado en el teléfono: se enviará cuando haya conexión.`;
}
