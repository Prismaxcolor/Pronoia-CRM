import { registerSW } from 'virtual:pwa-register';
import { marcarSwEnEspera } from './lib/offline/actualizador-servicio';

/** Registro del service worker (registerType 'prompt'): el SW nuevo queda en espera y NUNCA
 *  recarga la página por su cuenta. Aplicarlo es decisión de lib/offline/actualizador-servicio.ts,
 *  que solo lo hace en un momento seguro o cuando el usuario toca "Actualizar ahora", y siempre
 *  después de guardar los borradores. */

const INTERVALO_BUSCAR_VERSION_MS = 15 * 60 * 1000;

function programarBusquedaDeVersion(registro: ServiceWorkerRegistration): void {
  const buscar = () => {
    if (navigator.onLine === false) return;
    registro.update().catch(() => undefined);
  };
  setInterval(buscar, INTERVALO_BUSCAR_VERSION_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') buscar();
  });
}

export function iniciarActualizacionPwa(): void {
  registerSW({
    immediate: true,
    onNeedRefresh: marcarSwEnEspera,
    onRegisteredSW(_url, registro) {
      if (registro) programarBusquedaDeVersion(registro);
    },
  });
}
