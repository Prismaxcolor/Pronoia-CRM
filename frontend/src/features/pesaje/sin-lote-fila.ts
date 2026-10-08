import type { Producto } from '@shared/types/index.js';
import type { MaterialFila } from './material-fila';

/** true si el material elegido en esta fila va a inventario general (MPP) sin
 *  pedir lote: su categoría es "sin lote" y el producto no tiene lotes anclados.
 *  Lógica pura, separada de material-fila para poder probarla sin el navegador. */
export function esFilaSinLote(f: MaterialFila, productos: Producto[]): boolean {
  // Fila de un ticket ya guardado con el mismo producto: se respeta el destino
  // con el que se guardó, sin reinterpretarlo con el catálogo actual.
  if (f.guardado && f.guardado.productoId === f.productoId) return f.guardado.destinoTipo === 'mpp';
  const producto = productos.find(p => p.id === f.productoId);
  // Filas nuevas: un producto con lotes posibles anclados siempre pide lote,
  // aunque su categoría esté marcada "sin lote": los lotes se anclan a productos.
  return producto?.tipoMaterialSinLote === true && (producto.loteIds ?? []).length === 0;
}
