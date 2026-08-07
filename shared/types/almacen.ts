export interface Almacen {
  id: string;
  nombre: string;
  /** Dirección, notas u otro detalle libre. */
  detalle: string | null;
  activo: boolean;
  /** Único almacén que recibe/pierde stock automáticamente por compra/venta. */
  esPredeterminado: boolean;
  createdAt: string;
}
