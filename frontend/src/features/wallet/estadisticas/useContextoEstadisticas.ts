import { useMemo } from 'react';
import type { Banca, CategoriaWallet, Movimiento } from '@shared/types/index.js';
import { hayHistorialComparable, primeraFecha } from '../../../lib/cochinito-kpis';
import { MONTO_OCULTO, formatearMonto } from '../wallet-grupos';
import { rangoDePeriodo, rangoMismoPeriodoAnioPasado, rangoPeriodoAnterior, tituloPeriodo, type ClavePeriodo } from '../wallet-periodos';
import type { ContextoEstadisticas } from './contexto';
import { mismoRango } from './estadisticas-curvas';
import { diasEnRango, prepararFlujo } from './estadisticas-logica';
import { soloCuentasActivas } from './estadisticas-saldos';

interface Entrada {
  periodo: ClavePeriodo;
  hoy: Date;
  movimientos: readonly Movimiento[];
  /** Cuentas activas y archivadas. */
  cuentas: readonly Banca[];
  indiceCategorias: ReadonlyMap<string, CategoriaWallet>;
  errorCategorias: string | null;
  tasaBinance: number | null;
  cargandoTasas: boolean;
  ocultarCantidades: boolean;
  cuentasOcultas: ReadonlySet<string>;
}

/** Arma el contexto que la pantalla de Estadísticas reparte a cada pestaña (períodos, flujos preparados y formateo de montos). */
export function useContextoEstadisticas(e: Entrada): ContextoEstadisticas {
  const { periodo, hoy, movimientos, cuentas, indiceCategorias, errorCategorias, tasaBinance, cargandoTasas, ocultarCantidades, cuentasOcultas } = e;
  return useMemo<ContextoEstadisticas>(() => {
    const rango = rangoDePeriodo(periodo, hoy);
    const rangoAnterior = rangoPeriodoAnterior(rango);
    const primera = primeraFecha(movimientos.filter(m => !m.anulado));
    const comparable = hayHistorialComparable(primera, rangoAnterior);
    // Hace un año solo se compara si hay historial de esa época y si no es el mismo tramo que el período anterior (caso 1A).
    const rangoAnioPasado = rangoMismoPeriodoAnioPasado(rango);
    const hayAnioPasado = hayHistorialComparable(primera, rangoAnioPasado) && !mismoRango(rangoAnioPasado, rangoAnterior);
    const nombres = new Map(cuentas.map(c => [c.id, c.nombre]));
    const esCuentaOculta = (id: string): boolean => ocultarCantidades || cuentasOcultas.has(id);
    const fmt = (monto: number, moneda = 'USD'): string => (ocultarCantidades ? MONTO_OCULTO : formatearMonto(monto, moneda));
    const fmtCuenta = (id: string, monto: number, moneda = 'USD'): string => (esCuentaOculta(id) ? MONTO_OCULTO : formatearMonto(monto, moneda));
    return {
      bancas: soloCuentasActivas(cuentas), bancasConArchivadas: cuentas, periodo, hoy: hoy.toISOString().slice(0, 10), rango, rangoAnterior, rangoAnioPasado,
      dias: diasEnRango(rango), tituloPeriodo: tituloPeriodo(periodo),
      actual: prepararFlujo(movimientos, rango),
      anterior: comparable ? prepararFlujo(movimientos, rangoAnterior) : null,
      anioPasado: hayAnioPasado ? prepararFlujo(movimientos, rangoAnioPasado) : null,
      indiceCategorias, errorCategorias, tasaBinance, cargandoTasas,
      ocultar: ocultarCantidades,
      fmt,
      fmtCuenta,
      fmtCuentas: (ids, monto, moneda = 'USD') => (ids.length === 1 ? fmtCuenta(ids[0], monto, moneda) : fmt(monto, moneda)),
      esCuentaOculta,
      nombreCuenta: id => nombres.get(id) ?? 'Cuenta archivada u oculta',
    };
  }, [periodo, hoy, movimientos, cuentas, indiceCategorias, errorCategorias, tasaBinance, cargandoTasas, ocultarCantidades, cuentasOcultas]);
}
