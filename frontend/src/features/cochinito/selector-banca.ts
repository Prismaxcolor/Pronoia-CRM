import { colorDeBanca } from '../../lib/color-banca';
import { formatearNumero } from '../../lib/formato';
import type { Banca } from '@shared/types/index.js';

/** Lo que el selector visual necesita de una cuenta/caja. */
type BancaVisible = Pick<Banca, 'id' | 'nombre' | 'moneda' | 'saldo' | 'imagenUrl' | 'color'>;

/** Entidad con foto para SeleccionarEntidadModal; `color` es el fondo de la tarjeta cuando no hay imagen. */
export interface EntidadBanca {
  id: string;
  nombre: string;
  fotos: string[];
  detalle: string;
  color: string;
}

/** Primera letra del nombre (mayúscula) para la tarjeta sin imagen; '?' si no hay nombre. */
export function inicialDeBanca(nombre: string): string {
  return nombre.trim().charAt(0).toUpperCase() || '?';
}

/** Línea bajo el nombre: "$1,500.5 · USD" (con saldo) o solo la moneda. */
export function detalleBanca(banca: Pick<Banca, 'moneda' | 'saldo'>, conSaldo: boolean): string {
  if (!conSaldo) return banca.moneda;
  const simbolo = banca.moneda === 'USD' ? '$' : 'Bs ';
  return `${simbolo}${formatearNumero(banca.saldo, 2)} · ${banca.moneda}`;
}

/** Cuentas -> entidades del selector visual. La imagen es la única foto; sin ella la tarjeta muestra color e inicial. */
export function entidadesDeBancas(bancas: readonly BancaVisible[], conSaldo: boolean): EntidadBanca[] {
  return bancas.map((b, indice) => ({
    id: b.id,
    nombre: b.nombre,
    fotos: b.imagenUrl ? [b.imagenUrl] : [],
    detalle: detalleBanca(b, conSaldo),
    color: colorDeBanca(b, indice),
  }));
}
