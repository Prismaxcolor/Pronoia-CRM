/**
 * Proveedor — entidad a la que la empresa le compra material. Evita re-tipear
 * datos en cada factura de compra (paralelo a `Cliente` en el lado de venta).
 */
export interface Proveedor {
  id: string;
  nombre: string;
  /** RFC / identificación fiscal — opcional, formato libre. */
  rfc: string | null;
  telefono: string | null;
  email: string | null;
  activo: boolean;
  /** ISO timestamp (created_at en BD). */
  createdAt: string;
}
