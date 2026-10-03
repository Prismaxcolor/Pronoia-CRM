export type TipoProducto = 'amarillo' | 'azul' | 'verde';

export interface VarianteProducto {
  id: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
}

/**
 * Subproducto dentro de un producto verde. Puede ser:
 *  - tipo 'ref'   → apunta a otro producto del catálogo (por id).
 *  - tipo 'manual'→ no existe en el catálogo, se ingresa nombre a mano.
 */
export type SubProductoRef =
  | { tipo: 'ref'; productoId: string; cantidad: number }
  | { tipo: 'manual'; nombre: string; cantidad: number };

/** Producto base — todos los tipos comparten estos campos */
export interface ProductoBase {
  id: string;
  nombre: string;
  descripcion: string;
  moneda: string;
  activo: boolean;
  tipo: TipoProducto;
  fotos: string[];
  /** Categoría de material (FK a tipos_material). null si aún no asignada. */
  tipoMaterialId: string | null;
  /** Nombre de la categoría, resuelto vía join. Solo lectura (no se envía). */
  tipoMaterialNombre?: string | null;
  /** true si la categoría de este producto es "sin lote" (ej. No Ferroso) —
   *  al pesarlo no se pide lote, va directo a inventario general (MPP).
   *  Resuelto vía join. Solo lectura (no se envía). */
  tipoMaterialSinLote?: boolean | null;
  creadoPor: string;
  creadoEn: string;
}

/** Amarillo: producto básico con peso */
export interface ProductoAmarillo extends ProductoBase {
  tipo: 'amarillo';
  peso: number;
}

/** Azul: producto con variantes (tallas, presentaciones, cantidades) */
export interface ProductoAzul extends ProductoBase {
  tipo: 'azul';
  variantes: VarianteProducto[];
}

/** Verde: producto compuesto por subproductos */
export interface ProductoVerde extends ProductoBase {
  tipo: 'verde';
  subProductos: SubProductoRef[];
}

export type Producto = ProductoAmarillo | ProductoAzul | ProductoVerde;
