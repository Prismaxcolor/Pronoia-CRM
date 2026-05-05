export type TipoProducto = 'amarillo' | 'azul' | 'verde';

export interface VarianteProducto {
  id: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
}

export interface SubProductoRef {
  productoId: string;
  cantidad: number;
}

/** Producto base — todos los tipos comparten estos campos */
export interface ProductoBase {
  id: string;
  nombre: string;
  descripcion: string;
  categoria: string;
  moneda: string;
  activo: boolean;
  tipo: TipoProducto;
  imagenUrl: string | null;
  creadoPor: string;
  creadoEn: string;
}

/** Amarillo: producto básico con peso y costo directo */
export interface ProductoAmarillo extends ProductoBase {
  tipo: 'amarillo';
  peso: number;
  costoUnitario: number;
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
  costoCalculado: number;
}

export type Producto = ProductoAmarillo | ProductoAzul | ProductoVerde;
