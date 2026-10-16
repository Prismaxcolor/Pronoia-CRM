export type TipoProducto = 'amarillo' | 'azul' | 'verde';

/** Estado del material (Ferroso / No ferroso): limpio o sucio. */
export type EstadoLimpiezaProducto = 'limpio' | 'sucio';

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
  /** Lotes posibles de este producto (producto_lotes). Vacío = no pertenece a
   *  ningún lote. En el pesaje, estos lotes se ofrecen primero. */
  loteIds?: string[];
  /** Estado del material para separar limpio/sucio en el inventario. Solo aplica a las categorías
   *  Ferroso y No ferroso. null = sin definir. Al guardar: omitido = no se toca; null = se borra. */
  estadoLimpieza?: EstadoLimpiezaProducto | null;
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
