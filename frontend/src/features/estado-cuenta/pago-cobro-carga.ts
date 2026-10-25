import { mensajeAmigable } from '../../lib/mensaje-error';

/** Estado de la carga de lo que el registro necesita para no equivocarse: bancas, facturas pendientes y adelantos. */
export type FaseCarga = 'cargando' | 'listo' | 'error';

/** Las tres peticiones esenciales, en orden: bancas, facturas, adelantos. Si cualquiera falla no se puede registrar. */
export function faseDeCarga(esenciales: readonly PromiseSettledResult<unknown>[]): Exclude<FaseCarga, 'cargando'> {
  return esenciales.some(r => r.status === 'rejected') ? 'error' : 'listo';
}

/** Mensaje en español para el aviso de error de carga (incluye la causa si es entendible: sin conexión, etc.). */
export function mensajeErrorCarga(esenciales: readonly PromiseSettledResult<unknown>[]): string {
  const fallo = esenciales.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  const causa = fallo ? mensajeAmigable(fallo.reason, { porDefecto: '' }) : '';
  return `No se pudieron cargar las facturas, los adelantos o las cuentas.${causa ? ` ${causa}` : ''} Sin ellos no es seguro registrar.`;
}

/** Por qué el botón de registrar está bloqueado por la carga de datos (null = no lo está). */
export function bloqueoPorCarga(fase: FaseCarga): string | null {
  if (fase === 'cargando') return 'Cargando facturas y cuentas…';
  if (fase === 'error') return 'No se pudieron cargar los datos. Usa Reintentar.';
  return null;
}
