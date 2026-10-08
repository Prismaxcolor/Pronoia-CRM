/** Packing list provisional (creado o editado sin conexión) y su versión resumida para el listado. Puro. */
import type { PackingListDetalle, PackingListItem, PackingListResumen } from '@shared/types/index.js';

const redondear2 = (n: number): number => Math.round(n * 100) / 100;

interface ItemEntrada {
  numero: number;
  numeroPaleta?: number | null;
  lote?: string | null;
  color?: string | null;
  pesoBruto: number;
  pesoPaleta: number;
}

/** Cuerpo del guardado tal como lo envía el formulario (cabecera + paletas). */
export type DatosPackingList = Omit<PackingListDetalle, 'id' | 'items' | 'createdAt' | 'updatedAt' | 'version' | 'creadoPorNombre'> & {
  items: ItemEntrada[];
};

export function itemsConNeto(items: readonly ItemEntrada[]): PackingListItem[] {
  return items.map(i => ({
    numero: i.numero,
    numeroPaleta: i.numeroPaleta ?? null,
    lote: i.lote ?? null,
    color: i.color ?? null,
    pesoBruto: i.pesoBruto,
    pesoPaleta: i.pesoPaleta,
    pesoNeto: redondear2(i.pesoBruto - i.pesoPaleta),
  }));
}

export function packingListProvisional(
  datos: DatosPackingList,
  id: string,
  ahoraIso: string,
  version = 1,
  creadoEn?: string,
): PackingListDetalle {
  return { ...datos, items: itemsConNeto(datos.items), id, version, createdAt: creadoEn ?? ahoraIso, updatedAt: ahoraIso };
}

export function resumenDePackingList(p: PackingListDetalle): PackingListResumen {
  const { items, ...cabecera } = p;
  return { ...cabecera, totalBultos: items.length, totalNeto: redondear2(items.reduce((s, i) => s + i.pesoNeto, 0)) };
}
