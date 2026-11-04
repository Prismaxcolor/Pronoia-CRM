import type { FotoMaterial } from './material-fila';

/** Un lote (PCB) a trasladar completo — se pesa igual que un material, con
 *  su propia tara y foto, en vez de asumir automáticamente el stock teórico. */
export interface LoteTrasladoFila {
  uid: number;
  loteId: string;
  pesoBruto: string;
  tara: string;
  fotos: FotoMaterial[];
}

let LOTE_TRASLADO_UID = 0;

export function loteTrasladoFilaVacia(): LoteTrasladoFila {
  return { uid: LOTE_TRASLADO_UID++, loteId: '', pesoBruto: '', tara: '0', fotos: [] };
}

/** Lotes recuperados de un borrador: uid nuevo y solo fotos ya subidas. */
export function lotesTrasladoDesdeBorrador(filas: LoteTrasladoFila[] | undefined): LoteTrasladoFila[] {
  return (filas ?? []).map(f => ({ ...loteTrasladoFilaVacia(), ...f, uid: LOTE_TRASLADO_UID++, fotos: f.fotos ?? [] }));
}

export function netoLoteTrasladoFila(f: LoteTrasladoFila): number {
  return (Number(f.pesoBruto) || 0) - (Number(f.tara) || 0);
}
