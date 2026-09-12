import type { Producto, Tara } from '@shared/types/index.js';
import { subirFotoTicket } from '../../services/storage-service';
import { previewFotoLocal, subirFotosLocal, type FotoLocal } from '../../lib/foto-picker';

/** Valor del selector de destino: el id de un lote real, o '' si el
 *  usuario todavía no eligió nada (sin preselección por defecto). */
export type DestinoValor = string;

/** Modo de captura de la tara de una fila: preconfigurada (tara × cantidad) o un kg manual. */
export type TaraModo = 'preconfigurada' | 'manual';

/** Una foto ya subida (viene de un ticket existente, tiene URL) o recién
 *  elegida en este formulario (todavía solo en el navegador, sin subir). */
export type FotoMaterial = FotoLocal;

/** URL para mostrar la miniatura, sea una foto ya subida o recién elegida. */
export const previewFoto = previewFotoLocal;

/** Una fila de material en los formularios de pesaje (valores como string para los inputs). */
export interface MaterialFila {
  /** id local para la key de React. */
  uid: number;
  productoId: string;
  subcategoria: string;
  pesoBruto: string;
  taraModo: TaraModo;
  taraId: string;
  taraCantidad: string;
  taraManual: string;
  /** id del lote destino, o '' si aún no se eligió. */
  destino: DestinoValor;
  /** Fotos de este material — cada material lleva las suyas (Bloque 46), no
   *  hay una sola foto general al final del ticket. */
  fotos: FotoMaterial[];
}

let UID = 0;

export function filaVacia(): MaterialFila {
  return {
    uid: UID++,
    productoId: '',
    subcategoria: '',
    pesoBruto: '',
    taraModo: 'preconfigurada',
    taraId: '',
    taraCantidad: '',
    taraManual: '',
    destino: '',
    fotos: [],
  };
}

/** Sube las fotos nuevas de una fila (las que ya tenían URL quedan igual) y
 *  devuelve el arreglo final de URLs a mandar al backend. Null si alguna
 *  subida falla — el caller decide qué mensaje de error mostrar. */
export function subirFotosFila(fotos: FotoMaterial[]): Promise<string[] | null> {
  return subirFotosLocal(fotos, subirFotoTicket);
}

/** Los 4 campos que describen cómo se captura la tara de una fila —
 *  cualquier formulario que pese algo (pesaje, transformación, toma
 *  física) los necesita, no solo MaterialFila. Estructural a propósito
 *  para no acoplar cada formulario al tipo completo de MaterialFila. */
export interface CampoTara {
  taraModo: TaraModo;
  taraId: string;
  taraCantidad: string;
  taraManual: string;
}

export function taraVacia(): CampoTara {
  return { taraModo: 'preconfigurada', taraId: '', taraCantidad: '', taraManual: '' };
}

/** Kg de tara resultantes de una fila, según su modo (preconfigurada × cantidad, o manual). */
export function taraKgFila(f: CampoTara, taras: Tara[]): number {
  if (f.taraModo === 'manual') return Number(f.taraManual) || 0;
  const tara = taras.find(t => t.id === f.taraId);
  if (!tara) return 0;
  return tara.peso * (Number(f.taraCantidad) || 0);
}

export function netoFila(f: MaterialFila, taras: Tara[]): number {
  return (Number(f.pesoBruto) || 0) - taraKgFila(f, taras);
}

/** Campos a actualizar en una fila al elegir (o quitar) una tara preconfigurada:
 *  al elegir una tara con cantidad vacía, arranca en 1 unidad; al quitarla
 *  (taraId vacío) también limpia la cantidad, para poder dejar la fila sin
 *  tara y pesar sin tara. */
export function seleccionarTaraFila(f: CampoTara, taraId: string): Pick<CampoTara, 'taraId' | 'taraCantidad'> {
  return {
    taraId,
    taraCantidad: taraId ? (f.taraCantidad || '1') : '',
  };
}

/** true si el material elegido en esta fila pertenece a una categoría "sin
 *  lote" (ej. No Ferroso, Bloque 47) — no se pide lote al pesarlo, va
 *  directo a inventario general (MPP). */
export function esFilaSinLote(f: MaterialFila, productos: Producto[]): boolean {
  return productos.find(p => p.id === f.productoId)?.tipoMaterialSinLote === true;
}

/** Campos de una fila (sin fotos, sin uid) en el formato que espera el
 *  backend — usado por crearTicket, completarTicket y editarTicket. Un
 *  material de categoría "sin lote" va a MPP sin loteId; el resto va al
 *  lote que el usuario eligió. */
export function materialAPayload(f: MaterialFila, taras: Tara[], productos: Producto[]): {
  productoId: string;
  subcategoria: string | null;
  pesoBruto: number;
  tara: number;
  destinoTipo: 'mpp' | 'lote';
  loteId: string | null;
} {
  const sinLote = esFilaSinLote(f, productos);
  return {
    productoId: f.productoId,
    subcategoria: f.subcategoria.trim() || null,
    pesoBruto: Number(f.pesoBruto) || 0,
    tara: taraKgFila(f, taras),
    destinoTipo: sinLote ? 'mpp' : 'lote',
    loteId: sinLote ? null : f.destino,
  };
}
