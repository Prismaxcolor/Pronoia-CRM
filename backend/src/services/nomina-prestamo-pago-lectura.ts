import { supabaseAdmin } from '../config/supabase.js';
import { esObjetoInexistente } from '../utils/migracion-pendiente.js';
import { falloNomina, type FalloNomina } from '../utils/nomina-errores.js';
import { IDS_POR_CONSULTA, trocear } from '../utils/paginacion.js';
import type { PagoPrestamo } from '../../../shared/types/nomina.js';

type Fila = Record<string, unknown>;

const COLUMNAS_PAGO = '*, banca:bancas(nombre), movimiento:movimientos(numero_sistema, anulado, comprobantes)';

export function mapPagoPrestamo(row: Fila): PagoPrestamo {
  const banca = row.banca as Fila | null;
  const movimiento = row.movimiento as Fila | null;
  return {
    id: row.id as string,
    bancaId: row.banca_id as string,
    bancaNombre: (banca?.nombre as string | undefined) ?? '',
    movimientoId: row.movimiento_id as string,
    movimientoNumero: movimiento?.numero_sistema == null ? null : Number(movimiento.numero_sistema),
    anulado: Boolean(movimiento?.anulado),
    moneda: row.moneda as PagoPrestamo['moneda'],
    monto: Number(row.monto),
    montoUsd: Number(row.monto_usd),
    tasaBs: row.tasa_bs == null ? null : Number(row.tasa_bs),
    fecha: row.fecha as string,
    referencia: (row.referencia as string | null) ?? null,
    comprobantes: (movimiento?.comprobantes as string[] | null | undefined) ?? [],
  };
}

/**
 * Pagos (desembolsos) de los préstamos indicados, por id de préstamo. Si la migración del desembolso aún no está aplicada
 * devuelve un mapa vacío (los préstamos se ven como siempre, sin pago); un fallo real de la BD sí se propaga.
 */
export async function pagosDePrestamos(ids: readonly string[]): Promise<{ pagos: Map<string, PagoPrestamo> } | FalloNomina> {
  if (ids.length === 0) return { pagos: new Map() };
  const lotes = await Promise.all(trocear(ids, IDS_POR_CONSULTA).map(trozo => supabaseAdmin
    .from('nomina_prestamo_pagos').select(COLUMNAS_PAGO).in('prestamo_id', trozo)));
  const fallo = lotes.find(l => l.error)?.error;
  if (fallo) {
    if (esObjetoInexistente(fallo)) return { pagos: new Map() };
    return falloNomina(fallo, 'prestamo_pagos_leer', 'No se pudo cargar el pago de los préstamos.');
  }
  const filas = lotes.flatMap(l => (l.data as unknown as Fila[] | null) ?? []);
  return { pagos: new Map(filas.map(f => [f.prestamo_id as string, mapPagoPrestamo(f)])) };
}

/**
 * Cuenta (banca) desde la que se pagó un préstamo, o null si no se ha pagado o la migración no está aplicada. Lanza si la
 * BD falla: quien autoriza debe fallar cerrado, no tratar el error como "sin pago".
 */
export async function bancaDePagoPrestamo(prestamoId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('nomina_prestamo_pagos').select('banca_id').eq('prestamo_id', prestamoId).maybeSingle();
  if (error) {
    if (esObjetoInexistente(error)) return null;
    throw new Error(error.message);
  }
  return (data as { banca_id: string } | null)?.banca_id ?? null;
}
