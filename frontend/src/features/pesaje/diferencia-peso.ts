/** Tolerancia en kg para redondeo/float antes de considerar la diferencia
 *  "a favor del proveedor" — evita bloquear por ruido de punto flotante. */
const TOLERANCIA_KG = 0.01;

/** % de diferencia sobre el peso global a partir del cual se considera
 *  fuera de rango (rojo) en vez de normal (verde). */
const UMBRAL_PORCENTAJE = 0.6;

/**
 * true si la diferencia (pesoGlobal - pesoNetoMateriales - devolucion) es
 * negativa más allá de la tolerancia: se itemizó más peso de material del
 * que la báscula general registró, o sea se le estaría pagando al
 * proveedor por peso que la báscula general nunca confirmó. No aplica a
 * pesaje exterior (no hay báscula general propia contra la cual comparar).
 */
export function diferenciaFavoreceProveedor(diferencia: number, pesajeExterior: boolean): boolean {
  return !pesajeExterior && diferencia < -TOLERANCIA_KG;
}

/** % de diferencia sobre el peso global (0 si no hay peso global contra qué comparar). */
export function porcentajeDiferencia(diferencia: number, pesoGlobal: number): number {
  if (!pesoGlobal || pesoGlobal <= 0) return 0;
  return (diferencia / pesoGlobal) * 100;
}

/** Clase de color Tailwind para mostrar la diferencia: verde si está dentro
 *  del umbral, rojo si se sale de rango o favorece al proveedor. */
export function colorClaseDiferencia(diferencia: number, pesoGlobal: number, pesajeExterior: boolean): string {
  if (pesajeExterior) return 'text-brand-700';
  if (diferenciaFavoreceProveedor(diferencia, pesajeExterior)) return 'text-red-600';
  const pct = Math.abs(porcentajeDiferencia(diferencia, pesoGlobal));
  return pct <= UMBRAL_PORCENTAJE ? 'text-green-600' : 'text-red-600';
}
