import type { Tara } from '@shared/types/index.js';
import { subirFotoTicket } from '../../services/storage-service';

/** Valor del selector de destino: el id de un lote real, o '' si el
 *  usuario todavía no eligió nada (sin preselección por defecto). */
export type DestinoValor = string;

/** Modo de captura de la tara de una fila: preconfigurada (tara × cantidad) o un kg manual. */
export type TaraModo = 'preconfigurada' | 'manual';

/** Una foto ya subida (viene de un ticket existente, tiene URL) o recién
 *  elegida en este formulario (todavía solo en el navegador, sin subir). */
export type FotoMaterial =
  | { tipo: 'existente'; url: string }
  | { tipo: 'nueva'; file: File; preview: string };

/** URL para mostrar la miniatura, sea una foto ya subida o recién elegida. */
export function previewFoto(f: FotoMaterial): string {
  return f.tipo === 'existente' ? f.url : f.preview;
}

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
    taraModo: 'manual',
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
export async function subirFotosFila(fotos: FotoMaterial[]): Promise<string[] | null> {
  const urls: string[] = [];
  for (const f of fotos) {
    if (f.tipo === 'existente') { urls.push(f.url); continue; }
    const url = await subirFotoTicket(f.file);
    if (!url) return null;
    urls.push(url);
  }
  return urls;
}

/** Kg de tara resultantes de una fila, según su modo (preconfigurada × cantidad, o manual). */
export function taraKgFila(f: MaterialFila, taras: Tara[]): number {
  if (f.taraModo === 'manual') return Number(f.taraManual) || 0;
  const tara = taras.find(t => t.id === f.taraId);
  if (!tara) return 0;
  return tara.peso * (Number(f.taraCantidad) || 0);
}

export function netoFila(f: MaterialFila, taras: Tara[]): number {
  return (Number(f.pesoBruto) || 0) - taraKgFila(f, taras);
}

/** Campos de una fila (sin fotos, sin uid) en el formato que espera el
 *  backend para un material con destino a lote — usado por crearTicket,
 *  completarTicket y editarTicket. */
export function materialAPayload(f: MaterialFila, taras: Tara[]): {
  productoId: string;
  subcategoria: string | null;
  pesoBruto: number;
  tara: number;
  destinoTipo: 'lote';
  loteId: string;
} {
  return {
    productoId: f.productoId,
    subcategoria: f.subcategoria.trim() || null,
    pesoBruto: Number(f.pesoBruto) || 0,
    tara: taraKgFila(f, taras),
    destinoTipo: 'lote',
    loteId: f.destino,
  };
}
