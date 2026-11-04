import type { Tara } from '@shared/types/index.js';
import { taraKgFila, taraVacia, type CampoTara, type FotoMaterial } from '../pesaje/material-fila';
import type { TipoSalida } from '../../lib/salida-mixta';

/** Fila de salida en el formulario de completar una transformación ferroso. */
export interface FilaSalida extends CampoTara {
  uid: number;
  productoId: string;
  /** 'lote' = salida mixta: el material de la fila va a un lote existente. */
  tipo: TipoSalida;
  loteDestinoId: string;
  almacenId: string;
  pesoBruto: string;
  fotos: FotoMaterial[];
}

/** Fila de salida en el formulario de completar una transformación PCB. */
export interface FilaSalidaPCB extends CampoTara {
  uid: number;
  /** 'material' = salida mixta: material suelto (producto + almacén). */
  tipo: TipoSalida;
  productoId: string;
  loteDestinoId: string;
  almacenId: string;
  pesoBruto: string;
  fotos: FotoMaterial[];
}

// Un solo contador para ambas variantes: los uid solo deben ser únicos dentro de un formulario.
let nextUid = 1;

export function filaVacia(productoId = ''): FilaSalida {
  return { uid: nextUid++, productoId, tipo: 'material', loteDestinoId: '', almacenId: '', pesoBruto: '', ...taraVacia(), fotos: [] };
}

export function filaSalidaPCBVacia(): FilaSalidaPCB {
  return { uid: nextUid++, tipo: 'lote', productoId: '', loteDestinoId: '', almacenId: '', pesoBruto: '', ...taraVacia(), fotos: [] };
}

/** Neto de una salida: bruto menos tara (sin redondear, como siempre en este formulario). */
export function netoSalida(f: Pick<FilaSalida, 'pesoBruto'> & CampoTara, taras: Tara[]): number {
  return (Number(f.pesoBruto) || 0) - taraKgFila(f, taras);
}

export function totalNetoSalidas(filas: ReadonlyArray<Pick<FilaSalida, 'pesoBruto'> & CampoTara>, taras: Tara[]): number {
  return filas.reduce((acc, f) => acc + netoSalida(f, taras), 0);
}
