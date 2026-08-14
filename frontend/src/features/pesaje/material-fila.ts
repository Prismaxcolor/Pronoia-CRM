import type { Tara } from '@shared/types/index.js';

/** Valor del selector de destino: el id de un lote real, o '' si el
 *  usuario todavía no eligió nada (sin preselección por defecto). */
export type DestinoValor = string;

/** Modo de captura de la tara de una fila: preconfigurada (tara × cantidad) o un kg manual. */
export type TaraModo = 'preconfigurada' | 'manual';

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
  };
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
