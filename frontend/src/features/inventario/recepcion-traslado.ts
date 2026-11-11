import type { Tara } from '@shared/types/index.js';
import { redondearKg } from '@shared/types/ticket-pesaje.js';
import { taraNoVigente } from '../../lib/borrador-vigentes';
import { filaTaraIncompleta, taraTotalKg, taraUnidadVacia, type ConTarasExtra, type TaraUnidad } from '../pesaje/tara-multiple';

/** Lógica pura de la recepción de un traslado: cada línea captura el peso BRUTO que llegó y
 *  sus taras (mismo esquema que el pesaje); el neto recibido = bruto − taras, a 3 decimales. */

const MENSAJE_TARA_NO_VIGENTE = 'Una tara elegida ya no está disponible. Vuelve a elegirla.';

/** Una línea de la recepción (valores como string para los inputs). */
export interface FilaRecepcion extends TaraUnidad, ConTarasExtra {
  pesoBruto: string;
}

/** Misma regla que taraFilaNoVigente de pesaje/material-fila (sin arrastrar sus imports de red). */
function taraFilaNoVigente(f: FilaRecepcion, taras: Tara[]): boolean {
  const vigentes = taras.filter(t => t.activo).map(t => t.id);
  return taraNoVigente(f, vigentes) || (f.tarasExtra ?? []).some(e => taraNoVigente(e, vigentes));
}

/** Por defecto la línea arranca con lo enviado como bruto y sin tara: recibido = enviado. */
export function filaRecepcionInicial(pesoNetoEnviado: number): FilaRecepcion {
  return { ...taraUnidadVacia(), pesoBruto: String(redondearKg(pesoNetoEnviado)) };
}

/** Borrador anterior (solo "recibido" neto por línea): pasa a bruto con tara vacía. */
export function filaRecepcionDesdeNeto(recibido: string): FilaRecepcion {
  return { ...taraUnidadVacia(), pesoBruto: recibido };
}

export function netoRecibidoFila(f: FilaRecepcion, taras: Tara[]): number {
  return redondearKg((Number(f.pesoBruto) || 0) - taraTotalKg(f, taras));
}

/** Cuerpo de una línea para `PATCH /api/traslados/:id/completar`. `pesoRecibido` es el neto. */
export interface RecepcionLineaPayload {
  detalleId: string;
  pesoRecibido: number;
  pesoBrutoRecibido: number;
  taraRecibida: number;
}

export function recepcionAPayload(detalleId: string, f: FilaRecepcion, taras: Tara[]): RecepcionLineaPayload {
  const pesoBrutoRecibido = redondearKg(Number(f.pesoBruto) || 0);
  const taraRecibida = taraTotalKg(f, taras);
  return { detalleId, pesoRecibido: redondearKg(pesoBrutoRecibido - taraRecibida), pesoBrutoRecibido, taraRecibida };
}

/** Primer error de las líneas de la recepción, o null si todo está bien. */
export function validarRecepcion(filas: FilaRecepcion[], taras: Tara[]): string | null {
  if (filas.some(f => f.pesoBruto.trim() === '' || Number(f.pesoBruto) < 0)) {
    return 'Registra el peso bruto recibido de cada material (0 o más).';
  }
  if (filas.some(filaTaraIncompleta)) return 'Selecciona la tara preconfigurada para las unidades ingresadas.';
  if (filas.some(f => taraFilaNoVigente(f, taras))) return MENSAJE_TARA_NO_VIGENTE;
  if (filas.some(f => netoRecibidoFila(f, taras) < 0)) return 'El peso neto recibido no puede ser negativo. Revisa bruto y tara.';
  return null;
}

/** Diferencia (recibido − enviado) a 3 decimales. */
export function diferenciaRecepcion(netoRecibido: number, pesoNetoEnviado: number): number {
  return redondearKg(netoRecibido - pesoNetoEnviado);
}
