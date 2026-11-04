import { supabaseAdmin } from '../config/supabase.js';
import { esColumnaInexistente, esObjetoInexistente } from '../utils/migracion-pendiente.js';
import { falloNomina, type FalloNomina } from '../utils/nomina-errores.js';
import { armarCargo, type FilaCuotaCargo, type FilaLineaCargo, type FilaPagoCargo, type FilaPrestamoCargo } from '../utils/nomina-cargo.js';
import { nombreCompleto } from '../utils/nomina-armado.js';
import { partesDePago } from '../utils/nomina-partes-pago.js';
import { IDS_POR_CONSULTA, trocear } from '../utils/paginacion.js';
import type { CargoTrabajador, EstadoNomina, TipoPrestamo } from '../../../shared/types/nomina.js';

/** Un trabajador tiene a lo sumo unas 52 nóminas al año: este tope solo protege de una consulta desbordada. */
const LIMITE_FILAS = 1000;

type Fila = Record<string, unknown>;
type Consulta<T> = Promise<{ filas: T[] } | FalloNomina>;

async function leerLineas(trabajadorId: string): Consulta<FilaLineaCargo> {
  const { data, error } = await supabaseAdmin
    .from('nomina_lineas')
    .select('id, moneda_pago, total_usd, total_bs, pagar_usd, pagar_bs, nomina:nominas!inner(id, numero, semana_inicio, estado, cerrada_at)')
    .eq('trabajador_id', trabajadorId)
    .not('nomina.cerrada_at', 'is', null)
    .limit(LIMITE_FILAS);
  if (error) return falloNomina(error, 'cargo_lineas', 'No se pudo cargar el cargo del trabajador.');
  const filas = ((data as unknown as Fila[] | null) ?? []).map(l => {
    const n = l.nomina as Fila;
    const { pagarUsd, pagarBs } = partesDePago(l);
    return {
      lineaId: l.id as string, nominaId: n.id as string, nominaNumero: Number(n.numero), semanaInicio: n.semana_inicio as string,
      estadoNomina: n.estado as EstadoNomina, cerradaEn: (n.cerrada_at as string | null) ?? null, pagarUsd, pagarBs,
    };
  });
  return { filas };
}

const COLUMNAS_PAGO = 'nomina_id, moneda_pago, fecha, tasa_binance, tasa_binance_capturada, movimiento:movimientos(anulado)';

function consultarPagos(trozo: readonly string[], conLinea: boolean) {
  return supabaseAdmin
    .from('nomina_pagos')
    .select(conLinea ? `linea_id, ${COLUMNAS_PAGO}` : COLUMNAS_PAGO)
    .in('nomina_id', [...trozo])
    .limit(LIMITE_FILAS);
}

/**
 * Pagos de las nóminas del trabajador. Sin la migración del pago desde el Wallet no hay pagos: la lista queda vacía. Sin la
 * del pago por trabajador falta la columna linea_id: se lee sin ella (todos los pagos son de la nómina completa).
 */
async function leerPagos(nominaIds: readonly string[]): Consulta<FilaPagoCargo> {
  let lotes = await Promise.all(trocear(nominaIds, IDS_POR_CONSULTA).map(trozo => consultarPagos(trozo, true)));
  if (lotes.some(l => esColumnaInexistente(l.error, 'linea_id'))) {
    lotes = await Promise.all(trocear(nominaIds, IDS_POR_CONSULTA).map(trozo => consultarPagos(trozo, false)));
  }
  const fallo = lotes.find(l => l.error)?.error;
  if (fallo) return esObjetoInexistente(fallo) ? { filas: [] } : falloNomina(fallo, 'cargo_pagos', 'No se pudo cargar el cargo del trabajador.');
  const filas = lotes.flatMap(l => (l.data as unknown as Fila[] | null) ?? []).map(p => ({
    nominaId: p.nomina_id as string,
    lineaId: (p.linea_id as string | null | undefined) ?? null,
    monedaPago: p.moneda_pago as 'USD' | 'BS',
    fecha: p.fecha as string,
    anulado: Boolean((p.movimiento as Fila | null)?.anulado),
    tasaBinance: p.tasa_binance == null ? null : Number(p.tasa_binance),
    tasaBinanceCapturada: (p.tasa_binance_capturada as string | null) ?? null,
  }));
  return { filas };
}

async function leerPrestamos(trabajadorId: string): Consulta<FilaPrestamoCargo> {
  const { data, error } = await supabaseAdmin
    .from('nomina_prestamos').select('id, numero, tipo, monto_usd, saldo_usd, fecha, estado').eq('trabajador_id', trabajadorId).limit(LIMITE_FILAS);
  if (error) return falloNomina(error, 'cargo_prestamos', 'No se pudo cargar el cargo del trabajador.');
  const filas = ((data as unknown as Fila[] | null) ?? []).map(p => ({
    id: p.id as string, numero: Number(p.numero), tipo: p.tipo as TipoPrestamo, montoUsd: Number(p.monto_usd),
    saldoUsd: Number(p.saldo_usd), fecha: p.fecha as string, estado: p.estado as FilaPrestamoCargo['estado'],
  }));
  return { filas };
}

async function leerCuotas(prestamoIds: readonly string[]): Consulta<FilaCuotaCargo> {
  const lotes = await Promise.all(trocear(prestamoIds, IDS_POR_CONSULTA).map(trozo => supabaseAdmin
    .from('nomina_prestamo_movimientos')
    .select('id, tipo, monto_usd, created_at, prestamo:nomina_prestamos(numero), nomina:nominas(numero)')
    .in('prestamo_id', trozo)
    .limit(LIMITE_FILAS)));
  const fallo = lotes.find(l => l.error)?.error;
  if (fallo) return falloNomina(fallo, 'cargo_cuotas', 'No se pudo cargar el cargo del trabajador.');
  const filas = lotes.flatMap(l => (l.data as unknown as Fila[] | null) ?? []).map(c => ({
    id: c.id as string, tipo: c.tipo as 'CUOTA' | 'REVERSA', montoUsd: Number(c.monto_usd), creadoEn: c.created_at as string,
    prestamoNumero: Number((c.prestamo as Fila | null)?.numero ?? 0), nominaNumero: Number((c.nomina as Fila | null)?.numero ?? 0),
  }));
  return { filas };
}

/**
 * Cargo del trabajador: sus últimos movimientos de nómina. Los pagos en Bs traen el equivalente en USD a la tasa Binance
 * congelada al pagar (nomina_pagos.tasa_binance). Solo lectura.
 */
export async function obtenerCargoTrabajador(id: string): Promise<{ cargo: CargoTrabajador } | FalloNomina> {
  const { data: t, error } = await supabaseAdmin.from('nomina_trabajadores').select('id, nombres, apellidos').eq('id', id).maybeSingle();
  if (error) return falloNomina(error, 'cargo_trabajador', 'No se pudo cargar el trabajador.');
  if (!t) return { error: 'Trabajador no encontrado.', codigo: 404 };

  const [lineas, prestamos] = await Promise.all([leerLineas(id), leerPrestamos(id)]);
  if ('error' in lineas) return lineas;
  if ('error' in prestamos) return prestamos;
  const [pagos, cuotas] = await Promise.all([
    leerPagos([...new Set(lineas.filas.map(l => l.nominaId))]),
    leerCuotas(prestamos.filas.map(p => p.id)),
  ]);
  if ('error' in pagos) return pagos;
  if ('error' in cuotas) return cuotas;

  const { movimientos, saldoPrestamosUsd } = armarCargo({
    lineas: lineas.filas, pagos: pagos.filas, prestamos: prestamos.filas, cuotas: cuotas.filas,
  });
  return {
    cargo: {
      trabajadorId: t.id as string,
      nombre: nombreCompleto({ nombres: t.nombres as string, apellidos: t.apellidos as string }),
      saldoPrestamosUsd,
      movimientos,
    },
  };
}
