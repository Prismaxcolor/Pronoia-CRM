import type { Producto, Tara } from '@shared/types/index.js';
import type { FotoLocal } from '../../lib/foto-picker';
import { materialAPayload, taraKgFila, type MaterialFila } from './material-fila';
import type { LoteTrasladoFila } from './lote-traslado-fila';
import type { PesajeGlobalFila } from './pesaje-global-fila';

/** Subida de las fotos de cada fila del formulario "Nuevo pesaje" y armado de lo que se manda al
 *  backend. Cada función devuelve null si alguna subida falla (el caller muestra el mensaje).
 *  Las subidas van fila por fila, en orden, como siempre. */

/** Lo único que estas funciones necesitan del envío en curso. */
export interface SubidorFotos {
  subirFotos(fotos: FotoLocal[]): Promise<string[] | null>;
}

export interface MaterialTrasladoPayload {
  productoId: string;
  subcategoria: string | null;
  pesoBruto: number;
  tara: number;
  fotos: string[];
}

export interface LoteTrasladoPayload {
  loteId: string;
  pesoBruto: number;
  tara: number;
  fotos: string[];
}

export type MaterialTicketPayload = ReturnType<typeof materialAPayload> & { fotos: string[] };

export interface PesajeGlobalPayload {
  peso: number;
  tara?: number;
  fotos?: string[];
}

async function subirPorFila<F extends { fotos: FotoLocal[] }, P>(
  subidor: SubidorFotos,
  filas: readonly F[],
  armar: (fila: F, urls: string[]) => P,
): Promise<P[] | null> {
  const resultado: P[] = [];
  for (const fila of filas) {
    const urls = await subidor.subirFotos(fila.fotos);
    if (!urls) return null;
    resultado.push(armar(fila, urls));
  }
  return resultado;
}

export function subirMaterialesTraslado(subidor: SubidorFotos, filas: readonly MaterialFila[], taras: Tara[]): Promise<MaterialTrasladoPayload[] | null> {
  return subirPorFila(subidor, filas, (f, urls) => ({
    productoId: f.productoId,
    subcategoria: f.subcategoria.trim() || null,
    pesoBruto: Number(f.pesoBruto) || 0,
    tara: taraKgFila(f, taras),
    fotos: urls,
  }));
}

export function subirLotesTraslado(subidor: SubidorFotos, filas: readonly LoteTrasladoFila[]): Promise<LoteTrasladoPayload[] | null> {
  return subirPorFila(subidor, filas, (f, urls) => ({
    loteId: f.loteId,
    pesoBruto: Number(f.pesoBruto) || 0,
    tara: Number(f.tara) || 0,
    fotos: urls,
  }));
}

/** Fotos por material — cada línea sube las suyas (Bloque 46), en vez de una sola galería general al final del ticket. */
export function subirMaterialesTicket(subidor: SubidorFotos, filas: readonly MaterialFila[], taras: Tara[], productos: Producto[]): Promise<MaterialTicketPayload[] | null> {
  return subirPorFila(subidor, filas, (f, urls) => ({ ...materialAPayload(f, taras, productos), fotos: urls }));
}

/** Las pesadas globales sin fotos no suben nada (se mandan con fotos vacías). */
export async function subirPesajesGlobales(subidor: SubidorFotos, filas: readonly PesajeGlobalFila[]): Promise<PesajeGlobalPayload[] | null> {
  const payload: PesajeGlobalPayload[] = [];
  for (const f of filas) {
    let fotos: string[] = [];
    if (f.fotos.length > 0) {
      const subidas = await subidor.subirFotos(f.fotos);
      if (!subidas) return null;
      fotos = subidas;
    }
    payload.push({ peso: Number(f.peso) || 0, tara: Number(f.tara) || 0, fotos });
  }
  return payload;
}
