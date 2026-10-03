import { registerSW } from 'virtual:pwa-register';

/** Registra el service worker y fuerza UNA recarga automática cuando entra
 *  en control una versión nueva — sin esto, el navegador puede seguir
 *  sirviendo el shell/JS viejo desde caché varias recargas después de un
 *  deploy (el usuario ve la app "congelada" en una versión anterior). */
export function iniciarActualizacionPwa(): void {
  registerSW({ immediate: true });

  if (!('serviceWorker' in navigator)) return;

  // Si ya había un service worker controlando la página, un controllerchange
  // es una actualización real y toca recargar. Si todavía no había ninguno,
  // el primer controllerchange es solo la primera instalación — no recargar
  // (la página ya está sirviendo el contenido correcto).
  let yaHabiaControlador = !!navigator.serviceWorker.controller;
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!yaHabiaControlador) { yaHabiaControlador = true; return; }
    if (recargando) return;
    recargando = true;
    window.location.reload();
  });
}
