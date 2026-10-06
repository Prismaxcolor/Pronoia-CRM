import type { Transformacion } from '@shared/types/index.js';
import { netoDe } from './edicion-pesos-transformacion';
import { validarSalidas, type CategoriaSalida, type TipoSalida } from './salida-mixta';
import type { FotoMaterial } from '../features/pesaje/material-fila';

/** Fila de una pesada adicional (salida nueva) en la edición. Pesos como texto, igual que el resto del formulario. */
export interface FilaSalidaNueva {
  uid: number;
  tipo: TipoSalida;
  productoId: string;
  loteDestinoId: string;
  almacenId: string;
  pesoBruto: string;
  tara: string;
  fotos: FotoMaterial[];
}

export const aNumero = (s: string): number => (s.trim() === '' ? NaN : Number(s));

let siguienteUid = 1;

/** Ferroso: el material suelto es lo natural y va al almacén de la transformación salvo que se cambie. */
export function filaSalidaNuevaVacia(t: Pick<Transformacion, 'categoria' | 'almacenId'>): FilaSalidaNueva {
  const esPcb = t.categoria === 'pcb';
  return {
    uid: siguienteUid++,
    tipo: esPcb ? 'lote' : 'material',
    productoId: '',
    loteDestinoId: '',
    almacenId: esPcb ? '' : t.almacenId ?? '',
    pesoBruto: '',
    tara: '',
    fotos: [],
  };
}

/** El material que entra a un lote ferroso es el de entrada de la transformación; en PCB el lote hereda la composición. */
export function productoEfectivo(t: Pick<Transformacion, 'categoria' | 'productoEntradaId'>, f: FilaSalidaNueva): string {
  return t.categoria !== 'pcb' && f.tipo === 'lote' ? t.productoEntradaId ?? '' : f.productoId;
}

/** Primer error de las pesadas nuevas (selección y fotos); el balance de pesos lo valida la edición completa. */
export function validarFilasNuevas(t: Transformacion, filas: ReadonlyArray<FilaSalidaNueva>): string | null {
  return validarSalidas(
    t.categoria as CategoriaSalida,
    filas.map(f => ({
      tipo: f.tipo,
      productoId: productoEfectivo(t, f),
      loteDestinoId: f.loteDestinoId,
      almacenId: f.almacenId,
      neto: netoDe(aNumero(f.pesoBruto), aNumero(f.tara) || 0),
      cantidadFotos: f.fotos.length,
    })),
    { loteOrigenId: t.loteOrigenId, pesoEntrada: Number.POSITIVE_INFINITY }
  );
}

