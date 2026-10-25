/** Lógica pura de la lista de cambistas (sin React). Devuelve valores nuevos; no muta la entrada. */
import type { CambistaConSaldo } from '@shared/types/mesa-cambio';

export interface FiltroCambistas {
  q?: string;
  incluirInactivos?: boolean;
}

const sinTildes = (v: string): string => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function filtrarCambistas(lista: readonly CambistaConSaldo[], filtro: FiltroCambistas): CambistaConSaldo[] {
  const q = filtro.q ? sinTildes(filtro.q) : '';
  return lista.filter(c => {
    if (!filtro.incluirInactivos && !c.activo) return false;
    if (!q) return true;
    return [c.nombre, c.telefono, c.email].some(campo => campo && sinTildes(campo).includes(q));
  });
}

export interface TotalesMesa {
  /** Suma de los saldos positivos: lo que los cambistas nos deben en conjunto (pendiente por cobrar). */
  porCobrar: number;
  /** Suma de los saldos negativos, en positivo: lo que se les debe a los cambistas en conjunto. */
  seLesDebe: number;
}

export function totalesMesa(lista: readonly Pick<CambistaConSaldo, 'saldo'>[]): TotalesMesa {
  let porCobrar = 0;
  let seLesDebe = 0;
  for (const { saldo } of lista) {
    const centavos = Math.round(saldo * 100);
    if (centavos > 0) porCobrar += centavos;
    else seLesDebe -= centavos;
  }
  return { porCobrar: porCobrar / 100, seLesDebe: seLesDebe / 100 };
}
