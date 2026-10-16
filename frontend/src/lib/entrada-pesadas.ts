/** Varias pesadas en la ENTRADA de una transformación (ferroso/no ferroso y PCB).
 *
 *  Cada pesada tiene peso bruto, tara (preconfigurada × cantidad, o manual) y sus fotos; todas se suman
 *  en el peso neto de entrada. Con una sola pesada el resultado es el mismo que el formulario anterior.
 *  Lógica pura (sin React ni red): el formulario solo la usa. */
import type { Tara } from '@shared/types/index.js';
import type { CampoTara, FotoMaterial } from '../features/pesaje/material-fila';
import { taraTotalKg } from '../features/pesaje/tara-multiple';
import { taraNoVigente } from './borrador-vigentes';
import type { PesadaEntradaConFotos } from './offline/f4/peticiones-f4';

export const MAX_PESADAS_ENTRADA = 30;

export interface PesadaEntradaForm extends CampoTara {
  uid: number;
  /** Texto del input. */
  pesoBruto: string;
  fotos: FotoMaterial[];
}

let siguienteUid = 0;

export function nuevoUidPesadaEntrada(): number {
  siguienteUid += 1;
  return siguienteUid;
}

export function pesadaEntradaVacia(uid: number = nuevoUidPesadaEntrada()): PesadaEntradaForm {
  return { uid, pesoBruto: '', taraModo: 'preconfigurada', taraId: '', taraCantidad: '', taraManual: '', fotos: [] };
}

const redondear3 = (n: number): number => Math.round(n * 1000) / 1000;

export function taraPesadaKg(p: CampoTara, taras: Tara[]): number {
  return taraTotalKg(p, taras);
}

export function netoPesadaEntrada(p: PesadaEntradaForm, taras: Tara[]): number {
  return redondear3((Number(p.pesoBruto) || 0) - taraPesadaKg(p, taras));
}

export interface TotalesEntrada {
  cantidad: number;
  bruto: number;
  tara: number;
  neto: number;
}

export function totalesEntrada(pesadas: readonly PesadaEntradaForm[], taras: Tara[]): TotalesEntrada {
  const bruto = redondear3(pesadas.reduce((s, p) => s + (Number(p.pesoBruto) || 0), 0));
  const tara = redondear3(pesadas.reduce((s, p) => s + taraPesadaKg(p, taras), 0));
  return { cantidad: pesadas.length, bruto, tara, neto: redondear3(bruto - tara) };
}

/** Primer problema de las pesadas de entrada (mensaje para el usuario) o null si todas son válidas. */
export function validarPesadasEntrada(pesadas: readonly PesadaEntradaForm[], taras: Tara[]): string | null {
  if (pesadas.length === 0) return 'Agrega al menos una pesada de entrada.';
  if (pesadas.length > MAX_PESADAS_ENTRADA) return `Máximo ${MAX_PESADAS_ENTRADA} pesadas de entrada.`;
  const vigentes = taras.filter(t => t.activo).map(t => t.id);
  for (let i = 0; i < pesadas.length; i++) {
    const p = pesadas[i];
    const n = pesadas.length > 1 ? `Pesada ${i + 1}: ` : '';
    if (!(Number(p.pesoBruto) > 0)) return `${n}ingresa el peso bruto (mayor a 0).`;
    if (taraNoVigente(p, vigentes)) return `${n}una tara elegida ya no está disponible. Vuelve a elegirla.`;
    if (netoPesadaEntrada(p, taras) <= 0) return `${n}la tara debe ser menor al peso bruto (el neto debe ser mayor a 0).`;
    if (p.fotos.length === 0) return `${n}agrega al menos una foto.`;
  }
  return null;
}

/** Pesadas listas para enviar: bruto y tara numéricos, y sus fotos. */
export function aPesadasConFotos(pesadas: readonly PesadaEntradaForm[], taras: Tara[]): PesadaEntradaConFotos[] {
  return pesadas.map(p => ({ pesoBruto: Number(p.pesoBruto), tara: taraPesadaKg(p, taras), fotos: p.fotos }));
}

/** Borradores anteriores guardaban un solo peso (pesoBruto/campoTara/fotos): se convierten en una pesada. */
export function pesadasDeBorrador(d: {
  pesadasEntrada?: PesadaEntradaForm[];
  pesoBruto?: string;
  campoTara?: Partial<CampoTara>;
  tara?: string;
  fotos?: FotoMaterial[];
}): PesadaEntradaForm[] {
  if (Array.isArray(d.pesadasEntrada) && d.pesadasEntrada.length > 0) {
    return d.pesadasEntrada.map(p => ({ ...pesadaEntradaVacia(nuevoUidPesadaEntrada()), ...p, uid: nuevoUidPesadaEntrada() }));
  }
  const base = pesadaEntradaVacia();
  const conTaraManualAnterior: Partial<CampoTara> = d.tara && !d.campoTara ? { taraModo: 'manual', taraManual: d.tara } : {};
  return [{ ...base, pesoBruto: d.pesoBruto ?? '', ...d.campoTara, ...conTaraManualAnterior, fotos: d.fotos ?? [] }];
}
