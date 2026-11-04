/** Limpieza de lo que se cachea para LEER sin conexión (catálogos y registro de lecturas) al cerrar sesión o
 *  cambiar de usuario. NUNCA toca la cola de pendientes ni los borradores. */
import { limpiarCatalogos, purgarCatalogosDeOtrosUsuarios } from './catalogos';
import { registroLecturas } from './lectura';
import { registrarAlCambiarUsuario, registrarAlIniciarSesion } from './sesion';

export async function limpiarCacheDeLectura(): Promise<void> {
  try {
    await limpiarCatalogos();
  } finally {
    registroLecturas.limpiar();
  }
}

// Un usuario distinto en el mismo equipo no hereda la caché del anterior.
registrarAlCambiarUsuario(limpiarCacheDeLectura);
// Una sesión que terminó sin cierre explícito no deja su caché al siguiente usuario: se purga al iniciar o restaurar sesión.
registrarAlIniciarSesion(async id => { await purgarCatalogosDeOtrosUsuarios(id); });
