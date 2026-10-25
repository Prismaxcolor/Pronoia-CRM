import type { Vehiculo } from '@shared/types/index.js';

/** Datos mínimos de un vehículo para etiquetarlo o buscarlo por texto. */
type VehiculoBasico = Pick<Vehiculo, 'nombre' | 'placa'>;

/** Espejo de normalizarPlaca() del backend (schemas/vehiculo.ts): mayúsculas,
 *  sin espacios en los extremos y con los espacios internos colapsados. */
export function normalizarPlacaFront(valor: string): string {
  return valor.trim().replace(/\s+/g, ' ').toUpperCase();
}

/** Texto que se guarda en tickets_pesaje.vehiculo: "PLACA · nombre", o solo el
 *  nombre si el vehículo (antiguo) no tiene placa. */
export function etiquetaVehiculo(v: VehiculoBasico): string {
  return v.placa ? `${v.placa} · ${v.nombre}` : v.nombre;
}

function clave(texto: string): string {
  return texto.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Busca el vehículo del catálogo al que corresponde el texto guardado en un
 *  ticket. Acepta la etiqueta nueva ("PLACA · nombre"), el nombre antiguo o la
 *  placa sola. Prioridad: etiqueta, luego nombre, luego placa. */
export function buscarVehiculoPorTexto<T extends VehiculoBasico>(
  texto: string | null | undefined,
  vehiculos: T[],
): T | undefined {
  if (!texto || !texto.trim()) return undefined;
  const k = clave(texto);
  return (
    vehiculos.find(v => clave(etiquetaVehiculo(v)) === k) ??
    vehiculos.find(v => clave(v.nombre) === k) ??
    vehiculos.find(v => v.placa != null && clave(v.placa) === k)
  );
}
