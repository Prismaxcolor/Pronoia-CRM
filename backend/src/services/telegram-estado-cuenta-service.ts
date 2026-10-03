import { obtenerEstadoCuenta } from './estado-cuenta-service.js';
import { aEstadoCuentaPortal } from './portal-estado-cuenta.js';
import { entidadVinculada } from './telegram-notify-service.js';
import { notificarEstadoCuenta } from './telegram-eventos-service.js';
import type { EntidadTelegram } from './telegram-link-service.js';

/** Envío a pedido del estado de cuenta (botón del equipo): valida que exista y esté vinculado antes de avisar.
 *  Archivo aparte de telegram-eventos-service.ts para no crear un ciclo de imports con estado-cuenta-service. */
export async function enviarEstadoCuentaTelegram(
  entidadTipo: EntidadTelegram,
  entidadId: string
): Promise<{ ok: true } | { error: string; codigo: number }> {
  const estado = await obtenerEstadoCuenta(entidadTipo, entidadId);
  if (!estado) return { error: `${entidadTipo === 'proveedor' ? 'Proveedor' : 'Cliente'} no encontrado.`, codigo: 404 };
  if (!(await entidadVinculada(entidadTipo, entidadId))) {
    return { error: 'Esta entidad todavía no está vinculada a Telegram.', codigo: 409 };
  }
  notificarEstadoCuenta(entidadTipo, entidadId, aEstadoCuentaPortal(estado));
  return { ok: true };
}
