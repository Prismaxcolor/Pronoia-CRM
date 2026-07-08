/**
 * Tara predefinida — peso de referencia (ej. de un contenedor o vehículo)
 * que se puede reutilizar al pesar. Global: la ven y usan todos los usuarios.
 */
export interface Tara {
  id: string;
  nombre: string;
  peso: number;
  foto: string | null;
  activo: boolean;
  /** ISO timestamp (created_at en BD). */
  createdAt: string;
}
