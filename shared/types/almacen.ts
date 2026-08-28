export interface Almacen {
  id: string;
  nombre: string;
  /** Dirección, notas u otro detalle libre. */
  detalle: string | null;
  activo: boolean;
  /** Único almacén que recibe/pierde stock automáticamente por compra/venta. */
  esPredeterminado: boolean;
  /** Fecha (ISO) de la última toma física de inventario cerrada en este
   *  almacén, o null si nunca se hizo una. */
  ultimaTomaFisica: string | null;
  createdAt: string;
}
