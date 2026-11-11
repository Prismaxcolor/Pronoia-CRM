/** Datos ya preparados que la pantalla de Estadísticas reparte a cada pestaña (solo tipos; sin lógica). */

import type { Banca, CategoriaWallet } from '@shared/types/index.js';
import type { FlujoPreparado } from './estadisticas-logica';
import type { ClavePeriodo, RangoFechas } from '../wallet-periodos';

export interface ContextoEstadisticas {
  /** Cuentas activas (no archivadas): las que cuentan en saldos y activos. */
  bancas: readonly Banca[];
  /** Activas y archivadas: solo para nombrar y colorear movimientos de cuentas archivadas (agrupar gastos por cuenta). */
  bancasConArchivadas: readonly Banca[];
  /** Clave del período elegido (para los enlaces a Registros: `?p=`). */
  periodo: ClavePeriodo;
  /** Hoy en "AAAA-MM-DD" (para rotular "Hoy" en el eje X). */
  hoy: string;
  rango: RangoFechas;
  rangoAnterior: RangoFechas;
  /** Mismo período de hace un año (misma cantidad de días). */
  rangoAnioPasado: RangoFechas;
  /** Días del período elegido. */
  dias: number;
  tituloPeriodo: string;
  actual: FlujoPreparado;
  /** null = no hay historial para comparar (los datos empiezan después de que arranca el período anterior). */
  anterior: FlujoPreparado | null;
  /** null = no hay historial de hace un año, o el período coincide con el anterior (1A): esa curva no se dibuja. */
  anioPasado: FlujoPreparado | null;
  indiceCategorias: ReadonlyMap<string, CategoriaWallet>;
  /** Mensaje si no se pudieron cargar las categorías (los gastos saldrían todos como "Sin categoría"). */
  errorCategorias: string | null;
  /** Bs por USD (Binance); null si no cargó. */
  tasaBinance: number | null;
  cargandoTasas: boolean;
  /** Monto con su unidad, o MONTO_OCULTO si se ocultan las cantidades. */
  fmt: (monto: number, moneda?: string) => string;
  /** Como `fmt`, pero para el saldo de una cuenta: también se enmascara si esa cuenta tiene el ojo cerrado. */
  fmtCuenta: (cuentaId: string, monto: number, moneda?: string) => string;
  ocultar: boolean;
  /** Monto de un conjunto de cuentas: si es UNA sola, respeta su ojo cerrado (el monto es el de esa cuenta); si mezcla varias, solo "ocultar cantidades". */
  fmtCuentas: (cuentaIds: readonly string[], monto: number, moneda?: string) => string;
  /** true si los montos de esa cuenta no se muestran (ojo cerrado o "ocultar cantidades"). */
  esCuentaOculta: (cuentaId: string) => boolean;
  nombreCuenta: (id: string) => string;
}
