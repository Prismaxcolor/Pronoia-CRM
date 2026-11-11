/** Origen del detalle de un movimiento: de dónde vino la persona y a dónde vuelve. Lógica pura.
 *  La lista que abre el detalle pasa `origen` (ruta + filtros) en el estado del enrutador; sin él (enlace directo o la
 *  Wallet clásica) se vuelve a /cochinito, como siempre. Se prueba en backend/tests/wallet-registros-origen.test.ts. */

export const RUTA_ORIGEN_POR_DEFECTO = '/cochinito';

const RUTA_REGISTROS_WALLET = '/wallet/registros';

/** Solo rutas internas ("/…", no "//…"): cualquier otra cosa se ignora. */
function rutaInternaValida(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.startsWith('/') && !valor.startsWith('//');
}

/** Ruta a la que vuelve el detalle según el estado del enrutador. */
export function origenDeEstado(estado: unknown): string {
  const origen = (estado as { origen?: unknown } | null | undefined)?.origen;
  return rutaInternaValida(origen) ? origen : RUTA_ORIGEN_POR_DEFECTO;
}

export interface DestinoVolver {
  ruta: string;
  etiqueta: string;
}

/** Ruta y nombre para la miga de pan y el botón "Volver". */
export function destinoVolver(estado: unknown): DestinoVolver {
  const ruta = origenDeEstado(estado);
  const esRegistros = ruta === RUTA_REGISTROS_WALLET || ruta.startsWith(`${RUTA_REGISTROS_WALLET}?`);
  return { ruta, etiqueta: esRegistros ? 'Registros' : 'Wallet' };
}
