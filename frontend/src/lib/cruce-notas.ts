/**
 * Cruce parcial de notas de débito/crédito en el pago a proveedor y el cobro a cliente.
 *
 * Una nota ya no se consume completa: al registrar un pago/cobro se aplica el monto que se elija (hasta lo que le
 * queda a la nota) y el resto sigue disponible para otra operación. Lógica pura: la usa el modal de pago/cobro y la
 * prueban los tests del backend; la función SQL aplicar_item_cruce valida lo mismo con locks.
 */
import type { EntradaEstadoCuenta } from '../services/estado-cuenta-service';
import { redondear2, sugerirMontoCredito, validarMontoAplicable } from './cruce';

type NotaDelEstadoCuenta = Pick<EntradaEstadoCuenta, 'cargo' | 'abono' | 'notaDisponible'>;

/** Lo que le queda por aplicar a la nota: `notaDisponible` si el servidor lo informó; si no, su monto completo. */
export function disponibleDeNota(nota: NotaDelEstadoCuenta): number {
  return redondear2(nota.notaDisponible ?? (nota.cargo || nota.abono));
}

/** Texto del campo de monto de la nota en el formulario; vacío o inválido = ninguno. */
function montoEscrito(texto: string | undefined): number | null {
  if (texto === undefined) return null;
  const n = parseFloat(texto);
  return Number.isFinite(n) ? n : 0;
}

/** Monto (USD) que se aplica de la nota en este pago/cobro: lo escrito a mano o, sin edición, todo lo disponible. */
export function montoAplicadoDeNota(nota: NotaDelEstadoCuenta, montos: Readonly<Record<string, string>>, notaId: string): number {
  return montoEscrito(montos[notaId]) ?? disponibleDeNota(nota);
}

/** Monto sugerido al marcar una nota: la de débito va completa; la de crédito, lo que falta por cubrir (acotado a lo disponible). */
export function montoSugeridoDeNota(nota: NotaDelEstadoCuenta, tipo: 'debito' | 'credito', pendienteDeCubrir: number): number {
  const disponible = disponibleDeNota(nota);
  if (tipo === 'debito') return disponible;
  const sugerido = sugerirMontoCredito(disponible, pendienteDeCubrir);
  return sugerido > 0 ? sugerido : disponible;
}

/** Error si el monto aplicado de la nota no es válido (mayor a 0 y no más que lo disponible); null si está bien. */
export function errorMontoDeNota(nota: NotaDelEstadoCuenta, monto: number, nombre: string): string | null {
  return validarMontoAplicable(monto, disponibleDeNota(nota), nombre);
}
