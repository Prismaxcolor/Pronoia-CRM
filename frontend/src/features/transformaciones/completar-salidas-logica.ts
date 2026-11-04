import type { Tara } from '@shared/types/index.js';
import { restaurarFilas } from '../../lib/borrador';
import { mensajeSaneoBorrador, sanearIdsSalida, sanearTara, type CampoTaraMinimo, type FilaSalidaMinima } from '../../lib/borrador-vigentes';
import { validarMermaForm, type MermaForm } from '../../lib/merma-tipificada';
import { validarSalidas, type CategoriaSalida, type ContextoValidacion, type TipoSalida } from '../../lib/salida-mixta';
import { MENSAJE_TARA_NO_VIGENTE, taraFilaNoVigente, type CampoTara } from '../pesaje/material-fila';
import { netoSalida, type FilaSalida, type FilaSalidaPCB } from './salidas-fila';

/** Lógica pura de los formularios "Completar transformación" (ferroso y PCB): saneo del
 *  borrador restaurado, filas efectivas y validación antes de enviar. Sin React ni red. */

export function textoTarasReseteadas(cantidad: number): string {
  return cantidad === 1 ? 'una tara' : `${cantidad} taras`;
}

export interface VigentesSalidas {
  productoIds: string[];
  /** Solo lotes activos. */
  loteIds: string[];
  almacenIds: string[];
  taraIds: string[];
}

type FilaRestaurable = FilaSalidaMinima & CampoTaraMinimo & { uid: number; fotos?: unknown[] };

/** Filas de un borrador restaurado: material, lote, almacén o tara que ya no existen quedan
 *  sin elegir. Devuelve además el aviso para el usuario (null si no se reseteó nada). */
export function sanearFilasSalida<T extends FilaRestaurable>(
  guardadas: T[] | undefined,
  crearVacia: () => T,
  vigentes: VigentesSalidas,
): { filas: T[]; aviso: string | null } {
  const ids = sanearIdsSalida(restaurarFilas(guardadas, crearVacia), vigentes);
  let tarasReseteadas = 0;
  const filas = ids.filas.map(f => {
    const t = sanearTara(f, vigentes.taraIds);
    if (t.cambiada) tarasReseteadas += 1;
    return t.fila;
  });
  const elementos: string[] = [];
  if (ids.descartados > 0) elementos.push('material, lote o almacén de alguna salida');
  if (tarasReseteadas > 0) elementos.push(textoTarasReseteadas(tarasReseteadas));
  return { filas, aviso: mensajeSaneoBorrador(elementos) };
}

/** Ferroso: una salida a lote lleva el material de entrada de la transformación. */
export function filasEfectivasFerroso(filas: FilaSalida[], productoEntradaId: string | null | undefined): FilaSalida[] {
  return filas.map(f => (f.tipo === 'lote' ? { ...f, productoId: productoEntradaId ?? '' } : f));
}

/** PCB: el material suelto sale al almacén con el que se inició la transformación (si lo hay). */
export function filasEfectivasPCB(filas: FilaSalidaPCB[], almacenFijo: string): FilaSalidaPCB[] {
  return filas.map(f => (f.tipo === 'material' && almacenFijo ? { ...f, almacenId: almacenFijo } : f));
}

type FilaCompletable = CampoTara & { pesoBruto: string; tipo: TipoSalida; productoId: string; loteDestinoId: string; almacenId: string; fotos: unknown[] };

interface EntradaValidarCompletar<F extends FilaCompletable> {
  categoria: CategoriaSalida;
  filas: F[];
  taras: Tara[];
  contexto: ContextoValidacion;
  /** Lo que queda de la entrada tras restar las salidas (merma, o restante en PCB). */
  mermaKg: number;
  mermaForm: MermaForm;
}

/** Primer problema del formulario de completar (tara, salidas o merma tipificada), o null. */
export function validarCompletarSalidas<F extends FilaCompletable>(
  e: EntradaValidarCompletar<F>,
): string | null {
  if (e.filas.some(f => taraFilaNoVigente(f, e.taras))) return MENSAJE_TARA_NO_VIGENTE;
  const errorSalidas = validarSalidas(
    e.categoria,
    e.filas.map(f => ({ ...f, neto: netoSalida(f, e.taras), cantidadFotos: f.fotos.length })),
    e.contexto,
  );
  if (errorSalidas) return errorSalidas;
  return validarMermaForm(e.mermaKg, e.mermaForm);
}
