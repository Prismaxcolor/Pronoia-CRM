export interface Almacen {
  id: string;
  nombre: string;
  /** Dirección, notas u otro detalle libre. */
  detalle: string | null;
  activo: boolean;
  createdAt: string;
}
