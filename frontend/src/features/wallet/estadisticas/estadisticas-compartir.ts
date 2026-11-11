/** Textos de la imagen que se comparte desde cada tarjeta de Estadísticas. Lógica pura (sin DOM). Nunca lleva montos:
 *  los montos de la tarjeta ya salen enmascarados (MONTO_OCULTO) cuando se ocultan las cantidades. */

import { formatearFecha } from '../../../lib/formato';
import type { RangoFechas } from '../wallet-periodos';

export const MARCA_IMAGEN = 'Pronoia';

export interface RotuloImagen {
  marca: string;
  /** "ÚLTIMOS 30 DÍAS · 13/10/2026 al 11/11/2026". */
  periodo: string;
  /** "Generado el 11/11/2026". */
  pie: string;
}

export function rotuloPeriodo(tituloPeriodo: string, rango: RangoFechas): string {
  return `${tituloPeriodo} · ${formatearFecha(rango.desde)} al ${formatearFecha(rango.hasta)}`;
}

export function rotuloImagen(periodo: string, fecha: Date): RotuloImagen {
  return { marca: `${MARCA_IMAGEN} · Wallet`, periodo, pie: `Generado el ${formatearFecha(fecha)} · ${MARCA_IMAGEN}` };
}

/** Título del documento al compartir (y base del nombre de archivo). */
export const tituloCompartir = (tituloTarjeta: string): string => `Wallet ${tituloTarjeta}`;

/** Tiempo máximo para generar la imagen de una tarjeta: pasado esto se avisa del fallo en vez de dejar el botón girando. */
export const TIEMPO_MAXIMO_IMAGEN_MS = 20_000;

export class ErrorTiempoAgotado extends Error {
  constructor(ms: number) {
    super(`La operación superó ${Math.round(ms / 1000)} s`);
    this.name = 'ErrorTiempoAgotado';
  }
}

/** Igual que `promesa`, pero rechaza con ErrorTiempoAgotado si no termina en `ms`. Siempre limpia su temporizador. */
export function conTiempoMaximo<T>(promesa: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    const temporizador = setTimeout(() => rechazar(new ErrorTiempoAgotado(ms)), ms);
    promesa.then(
      valor => { clearTimeout(temporizador); resolver(valor); },
      error => { clearTimeout(temporizador); rechazar(error); },
    );
  });
}
