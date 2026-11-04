import type { Almacen, Lote, Producto, TicketPesaje } from '@shared/types/index.js';
import { esFilaSinLote } from './sin-lote-fila';
import type { MaterialFila } from './material-fila';
import type { LoteTrasladoFila } from './lote-traslado-fila';

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

/** true si el pesaje se registra sin pesaje global (casilla "Peso exterior / sin pesaje global").
 *  Aplica igual en compra y venta; el traslado no usa pesaje global. */
export function esSinPesajeGlobal(tipo: 'compra' | 'venta' | 'traslado', pesajeExterior: boolean): boolean {
  return tipo !== 'traslado' && pesajeExterior;
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

/** Cliente o proveedor tal como lo usa el formulario de pesaje. */
export interface EntidadPesaje { id: string; nombre: string; activo: boolean; fotos?: string[] }

/** Kg con separador es-VE, 2 a 3 decimales (así se muestran todos los pesos del formulario). */
export function formatearKgPesaje(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

/** Lotes con stock en el almacén dado (un lote puede tener kilos repartidos en varios almacenes). */
export function lotesConStockEnAlmacen(lotes: Lote[], almacenId: string, soloActivos = true): Lote[] {
  return lotes.filter(l => (!soloActivos || l.activo) && l.stockPorAlmacen.some(s => s.almacenId === almacenId && s.stockKg > 0));
}

/** Lotes que ofrece el selector de una fila de traslado: el suyo más los que ninguna otra fila ya eligió. */
export function opcionesLoteFila(lotesEnOrigen: Lote[], filas: LoteTrasladoFila[], fila: LoteTrasladoFila): Lote[] {
  return lotesEnOrigen.filter(l => l.id === fila.loteId || !filas.some(o => o.uid !== fila.uid && o.loteId === l.id));
}

/** Kg que el lote tiene en un almacén (0 si no hay registro). */
export function stockLoteEnAlmacen(lote: Lote | undefined, almacenId: string): number {
  return lote?.stockPorAlmacen.find(s => s.almacenId === almacenId)?.stockKg ?? 0;
}

export interface AvisoStock { disponible: number; quedara: number }

/** Aviso (sin bloquear) cuando el neto supera lo disponible: null si alcanza. */
export function avisoStockInsuficiente(neto: number, disponible: number): AvisoStock | null {
  return neto > disponible ? { disponible, quedara: disponible - neto } : null;
}

/** Filas con el material elegido en `uid`. Si el material tiene lotes anclados y el destino
 *  ya elegido no es uno de ellos, el destino se limpia. */
export function filasConProducto(filas: MaterialFila[], uid: number, productoId: string, productos: Producto[]): MaterialFila[] {
  const lotesDelProducto = productos.find(p => p.id === productoId)?.loteIds ?? [];
  return filas.map(f => {
    if (f.uid !== uid) return f;
    const destinoInvalido = lotesDelProducto.length > 0 && f.destino && !lotesDelProducto.includes(f.destino);
    return { ...f, destino: destinoInvalido ? '' : f.destino, productoId };
  });
}

/** Almacén que se manda con un ticket: solo si el negocio tiene más de uno, el elegido o el predeterminado. */
export function almacenIdDeTicket(almacenes: Almacen[], almacenOrigenId: string): string | null {
  const predeterminado = almacenes.find(a => a.esPredeterminado);
  return almacenes.length > 1 ? (almacenOrigenId || predeterminado?.id || null) : null;
}

export function mensajeTrasladoGenerado(codigo: string, pesoNetoEnviado: number): string {
  return `${codigo} generado (${formatearKgPesaje(pesoNetoEnviado)} kg). Queda pendiente hasta que el almacén destino confirme la recepción.`;
}

export function mensajeTicketGuardado(estado: 'bruto' | 'completo', codigo: string, pesoNetoTotal: number): string {
  return estado === 'bruto'
    ? `${codigo} guardado como pesaje global (por recepcionar). Complétalo luego desde la lista.`
    : `${codigo} generado (neto ${formatearKgPesaje(pesoNetoTotal)} kg).`;
}
