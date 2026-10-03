/**
 * Vehículo predefinido — placa/identificador reutilizable al registrar un
 * pesaje o traslado. Global: lo ven y usan todos los usuarios.
 */
export interface Vehiculo {
  id: string;
  nombre: string;
  /** Tipo o descripción opcional (ej. "Camión 350"). */
  descripcion: string | null;
  activo: boolean;
  /** ISO timestamp (created_at en BD). */
  createdAt: string;
}
