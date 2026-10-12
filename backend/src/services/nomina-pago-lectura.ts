import { supabaseAdmin } from '../config/supabase.js';
import { esObjetoInexistente } from '../utils/migracion-pendiente.js';
import { falloNomina, type FalloNomina } from '../utils/nomina-errores.js';
import type { PagoNomina } from '../../../shared/types/nomina.js';

type Fila = Record<string, unknown>;

const COLUMNAS_PAGO = '*, banca:bancas(nombre), movimiento:movimientos(numero_sistema, anulado)';

function mapPago(row: Fila): PagoNomina {
  const banca = row.banca as Fila | null;
  const movimiento = row.movimiento as Fila | null;
  return {
    id: row.id as string,
    monedaPago: row.moneda_pago as PagoNomina['monedaPago'],
    bancaId: row.banca_id as string,
    bancaNombre: (banca?.nombre as string | undefined) ?? '',
    movimientoId: row.movimiento_id as string,
    movimientoNumero: movimiento?.numero_sistema == null ? null : Number(movimiento.numero_sistema),
    anulado: Boolean(movimiento?.anulado),
    monto: Number(row.monto),
    montoUsd: Number(row.monto_usd),
    cantidad: Number(row.cantidad),
    fecha: row.fecha as string,
    referencia: (row.referencia as string | null) ?? null,
    pagadoEn: row.created_at as string,
  };
}

/**
 * Pagos de una nómina desde el Wallet. Si la migración del pago aún no está aplicada devuelve lista vacía (la nómina
 * se ve como siempre); un fallo real de la BD sí se propaga: mostrar "sin pagar" por un error invitaría a pagar de nuevo.
 */
export async function pagosDeNomina(nominaId: string): Promise<{ pagos: PagoNomina[] } | FalloNomina> {
  const { data, error } = await supabaseAdmin.from('nomina_pagos').select(COLUMNAS_PAGO).eq('nomina_id', nominaId).order('moneda_pago');
  if (error) {
    if (esObjetoInexistente(error)) return { pagos: [] };
    return falloNomina(error, 'nomina_pagos_leer', 'No se pudo cargar el pago de la nómina.');
  }
  return { pagos: ((data as unknown as Fila[] | null) ?? []).map(mapPago) };
}

/**
 * Ids de las cuentas (bancas) con que se pagó una nómina; [] si no está pagada o la migración del pago no está
 * aplicada. Lanza si la BD falla: quien autoriza debe fallar cerrado, no tratar el error como "sin pago".
 */
export async function bancasDePagoNomina(nominaId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin.from('nomina_pagos').select('banca_id').eq('nomina_id', nominaId);
  if (error) {
    if (esObjetoInexistente(error)) return [];
    throw new Error(error.message);
  }
  return [...new Set(((data as Array<{ banca_id: string }> | null) ?? []).map(f => f.banca_id))];
}
