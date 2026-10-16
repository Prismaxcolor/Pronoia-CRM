import type { PackingListDetalle } from '@shared/types/index.js';
import type { GuardarPackingListInput } from '../../services/packing-list-service';
import { cabeceraDesde, construirEntrada, filasDesde, type ValoracionForm } from '../packing-list/formulario';

/** Pasos del asistente «Nueva exportación». Lógica pura (sin React) para poder probarla. */

export type NumeroPaso = 1 | 2 | 3;

export const PASOS: ReadonlyArray<{ numero: NumeroPaso; titulo: string; ayuda: string }> = [
  { numero: 1, titulo: 'Packing list y cliente', ayuda: 'Elige el packing list y el cliente internacional.' },
  { numero: 2, titulo: 'Valorar el packing list', ayuda: 'Escribe el valor estimado por kg de cada lote.' },
  { numero: 3, titulo: 'Resultados', ayuda: 'Compara la proyección con lo realmente obtenido.' },
];

/**
 * Paso que indica la URL (`?paso=`). Una exportación nueva siempre empieza en el 1; una existente, sin indicación
 * válida, en el 2 (ya tiene packing list y cliente).
 */
export function pasoDesdeParametro(texto: string | null, existente: boolean): NumeroPaso {
  const inicial: NumeroPaso = existente ? 2 : 1;
  if (!existente) return inicial;
  return texto === '1' || texto === '2' || texto === '3' ? (Number(texto) as NumeroPaso) : inicial;
}

interface EleccionInicial {
  packingListId: string;
  clienteId: string;
}

/** El paso 1 necesita packing list y cliente; los demás pasos no bloquean el avance. */
export function puedeAvanzarDesde(paso: NumeroPaso, eleccion: EleccionInicial): boolean {
  return paso !== 1 || (eleccion.packingListId !== '' && eleccion.clienteId !== '');
}

export interface OpcionesEntradaExportacion {
  clienteId: string;
  valoracion: ValoracionForm;
  /** facturacion:ver. Sin él no se envía la proyección y el servidor conserva lo guardado. */
  puedeVerValores: boolean;
  /** Inventario o facturación (control interno). Sin él no se envían almacén ni fotos. */
  puedeVerControl: boolean;
}

/**
 * Arma lo que se guarda al avanzar en el asistente: el packing list tal como está en el servidor, con el cliente
 * y la valoración elegidos. Reutiliza el mismo armado y validación que el editor del packing list.
 */
export function entradaDeExportacion(
  detalle: PackingListDetalle,
  opciones: OpcionesEntradaExportacion
): { entrada: GuardarPackingListInput } | { error: string } {
  const cabecera = { ...cabeceraDesde(detalle), clienteId: opciones.clienteId };
  const referencia = { referenciaTipo: detalle.referenciaTipo, referenciaId: detalle.referenciaId, version: detalle.version };
  return construirEntrada(
    cabecera,
    filasDesde(detalle),
    referencia,
    opciones.puedeVerValores ? opciones.valoracion : undefined,
    opciones.puedeVerControl
  );
}
