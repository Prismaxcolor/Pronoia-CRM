import type { Producto, Tara } from '@shared/types/index.js';
import { esFilaSinLote, netoFila, taraFilaNoVigente, MENSAJE_TARA_NO_VIGENTE, type MaterialFila } from './material-fila';
import { filaTaraIncompleta } from './tara-multiple';
import { netoLoteTrasladoFila, type LoteTrasladoFila } from './lote-traslado-fila';
import { sumaPesajesGlobales, type PesajeGlobalFila } from './pesaje-global-fila';
import { diferenciaFavoreceProveedor } from './diferencia-peso';
import type { FotoMaterial } from './material-fila';

/** Validaciones del formulario "Nuevo pesaje". Cada una devuelve el primer mensaje de
 *  error para el usuario, o null si todo está bien. Lógica pura (sin React ni red). */

/** Materiales de un traslado: las filas sin material elegido se ignoran. */
export function materialesLlenos(materiales: MaterialFila[]): MaterialFila[] {
  return materiales.filter(f => f.productoId);
}

function validarPesosYFotosMateriales(filas: MaterialFila[], taras: Tara[]): string | null {
  if (filas.some(f => taraFilaNoVigente(f, taras))) return MENSAJE_TARA_NO_VIGENTE;
  if (filas.some(f => netoFila(f, taras) < 0)) return 'El peso neto de un material no puede ser negativo. Revisa bruto y tara.';
  if (filas.some(f => netoFila(f, taras) <= 0)) return 'Cada material debe tener un peso neto mayor a 0.';
  if (filas.some(f => f.fotos.length === 0)) return 'Cada material necesita al menos una foto.';
  return null;
}

export interface EntradaValidarTraslado {
  almacenOrigenId: string;
  almacenDestinoId: string;
  materiales: MaterialFila[];
  loteFilas: LoteTrasladoFila[];
  taras: Tara[];
}

export function validarTraslado(e: EntradaValidarTraslado): string | null {
  const llenos = materialesLlenos(e.materiales);
  if (!e.almacenOrigenId) return 'Elige el almacén de origen.';
  if (!e.almacenDestinoId) return 'Elige el almacén de destino.';
  if (e.almacenOrigenId === e.almacenDestinoId) return 'El almacén de origen y destino no pueden ser el mismo.';
  if (llenos.length === 0 && e.loteFilas.length === 0) return 'Agrega al menos un material o un lote a trasladar.';
  const errorMateriales = validarPesosYFotosMateriales(llenos, e.taras);
  if (errorMateriales) return errorMateriales;
  if (e.loteFilas.some(f => !f.loteId)) return 'Selecciona el lote de cada fila.';
  if (e.loteFilas.some(f => netoLoteTrasladoFila(f) <= 0)) return 'Cada lote debe tener un peso neto mayor a 0.';
  if (e.loteFilas.some(f => f.fotos.length === 0)) return 'Cada lote necesita al menos una foto del pesaje.';
  return null;
}

export interface EntradaValidarTicket {
  estado: 'bruto' | 'completo';
  entidadId: string;
  labelEntidad: string;
  sinPesajeGlobal: boolean;
  pesajesGlobales: PesajeGlobalFila[];
  materiales: MaterialFila[];
  productos: Producto[];
  taras: Tara[];
  devolucion: string;
  fotosDevolucion: FotoMaterial[];
  diferencia: number;
}

function validarPesajesGlobales(e: EntradaValidarTicket): string | null {
  if (e.sinPesajeGlobal) return null;
  if (sumaPesajesGlobales(e.pesajesGlobales) <= 0) return 'Registra al menos un pesaje global con peso mayor a 0.';
  if (e.pesajesGlobales.some(g => g.fotos.length === 0)) return 'Cada pesaje global necesita al menos una foto.';
  return null;
}

function validarTicketCompleto(e: EntradaValidarTicket): string | null {
  if (e.materiales.some(f => !f.productoId)) return 'Cada material debe tener un producto seleccionado.';
  if (e.materiales.some(f => !esFilaSinLote(f, e.productos) && !f.destino)) return 'Cada material debe tener un destino seleccionado.';
  if (e.materiales.some(filaTaraIncompleta)) return 'Selecciona la tara preconfigurada para las unidades ingresadas.';
  const errorMateriales = validarPesosYFotosMateriales(e.materiales, e.taras);
  if (errorMateriales) return errorMateriales;
  if (Number(e.devolucion) > 0 && e.fotosDevolucion.length === 0) return 'Agrega al menos una foto de la devolución.';
  if (diferenciaFavoreceProveedor(e.diferencia, e.sinPesajeGlobal)) {
    return 'La suma de materiales + devolución supera el peso global — eso favorece al proveedor. Revisa los pesos antes de guardar.';
  }
  return null;
}

export function validarTicket(e: EntradaValidarTicket): string | null {
  if (!e.entidadId) return `Elige un ${e.labelEntidad.toLowerCase()}.`;
  const errorGlobal = validarPesajesGlobales(e);
  if (errorGlobal) return errorGlobal;
  return e.estado === 'completo' ? validarTicketCompleto(e) : null;
}
