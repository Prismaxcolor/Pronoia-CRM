/**
 * Vehículo predefinido — identificado por placa y fotos, reutilizable al
 * registrar un pesaje o traslado. Global: lo ven y usan todos los usuarios.
 */
export interface Vehiculo {
  id: string;
  /** Nombre corto con el que se conoce el vehículo (ej. "Margarita"). */
  nombre: string;
  /** Placa normalizada (mayúsculas). Null solo en vehículos antiguos sin placa. */
  placa: string | null;
  marca: string | null;
  modelo: string | null;
  color: string | null;
  /** Chofer habitual (texto libre). */
  conductor: string | null;
  /** Tipo o descripción opcional (ej. "Camión 350"). */
  descripcion: string | null;
  /** URLs de fotos (bucket 'tickets'). */
  fotos: string[];
  activo: boolean;
  /** ISO timestamp (created_at en BD). */
  createdAt: string;
}
