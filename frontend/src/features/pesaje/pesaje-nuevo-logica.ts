import type { Producto, TicketPesaje } from '@shared/types/index.js';
import { esFilaSinLote } from './sin-lote-fila';
import type { MaterialFila } from './material-fila';

/** Qué le falta a una fila de material para poder agregar otra: lista de
 *  etiquetas legibles, vacía si la fila está completa. Lógica pura. */
export function faltantesFila(f: MaterialFila, productos: Producto[]): string[] {
  const faltan: string[] = [];
  if (!f.productoId) faltan.push('tipo de material');
  if (!(Number(f.pesoBruto) > 0)) faltan.push('peso');
  if (f.productoId && !esFilaSinLote(f, productos) && !f.destino) faltan.push('lote');
  if (f.fotos.length === 0) faltan.push('foto del peso bruto');
  return faltan;
}

/** Faltantes de la última fila (la que se está cargando); [] si no hay filas. */
export function faltantesParaAgregar(filas: MaterialFila[], productos: Producto[]): string[] {
  const ultima = filas[filas.length - 1];
  return ultima ? faltantesFila(ultima, productos) : [];
}

/** true si elegir este producto en una fila nueva obliga a elegir lote. */
export function productoRequiereLote(productoId: string, productos: Producto[]): boolean {
  const producto = productos.find(p => p.id === productoId);
  if (!producto) return false;
  return !(producto.tipoMaterialSinLote === true && (producto.loteIds ?? []).length === 0);
}

/** Tickets en bruto de un proveedor, para continuarlos desde un pesaje nuevo. */
export function ticketsBrutoDeEntidad(tickets: TicketPesaje[], entidadId: string): TicketPesaje[] {
  if (!entidadId) return [];
  return tickets.filter(t => t.estado === 'bruto' && t.entidadId === entidadId && !t.ticketPrincipalId);
}

const CLAVE_CATEGORIA = 'pronoia:pesaje:categoria';

interface AlmacenamientoMinimo {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
}

function almacenamientoNavegador(): AlmacenamientoMinimo | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Última categoría (tipo de material) elegida en el selector de materiales. */
export function leerCategoriaRecordada(almacen: AlmacenamientoMinimo | null = almacenamientoNavegador()): string | null {
  try {
    return almacen?.getItem(CLAVE_CATEGORIA) || null;
  } catch {
    return null;
  }
}

export function guardarCategoriaRecordada(
  categoriaId: string | null,
  almacen: AlmacenamientoMinimo | null = almacenamientoNavegador(),
): void {
  try {
    almacen?.setItem(CLAVE_CATEGORIA, categoriaId ?? '');
  } catch {
    // Sin almacenamiento solo se pierde la memoria de la categoría.
  }
}

/** La categoría recordada solo vale si todavía existe entre las disponibles. */
export function categoriaVigente(recordada: string | null, idsDisponibles: string[]): string | null {
  return recordada && idsDisponibles.includes(recordada) ? recordada : null;
}
