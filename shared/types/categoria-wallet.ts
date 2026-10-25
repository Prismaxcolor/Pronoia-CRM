/** Categorías y subcategorías del Wallet (dos niveles). Espejo en backend/src/services/categoria-service.ts. */
export type TipoCategoria = 'INGRESO' | 'EGRESO' | 'AMBOS';

export interface CategoriaWallet {
  id: string;
  nombre: string;
  tipo: TipoCategoria;
  /** Hex #RRGGBB en mayúsculas. */
  color: string;
  /** null = categoría; con valor = subcategoría de esa categoría. */
  padreId: string | null;
  /** false = archivada: no se ofrece al registrar, pero los movimientos que ya la usan la conservan. */
  activo: boolean;
  /** URL pública de la imagen (logo); null = sin imagen. Complementa al nombre y al color, no los reemplaza. */
  imagenUrl: string | null;
  creadoEn: string;
}

/** Totales de un grupo de movimientos en UNA moneda (nunca se mezclan monedas). total = ingresos - egresos. */
export interface TotalesMoneda {
  moneda: string;
  ingresos: number;
  egresos: number;
  total: number;
}

export interface SubtotalReporteCategoria {
  /** null = movimientos sin categoría. */
  categoriaId: string | null;
  nombre: string;
  color: string | null;
  movimientos: number;
  totales: TotalesMoneda[];
}

export interface GrupoReporteCategoria extends SubtotalReporteCategoria {
  subcategorias: SubtotalReporteCategoria[];
}

export interface ReporteCategorias {
  desde: string;
  hasta: string;
  grupos: GrupoReporteCategoria[];
  totalesGenerales: TotalesMoneda[];
  /** Movimientos que no entran porque están en cuentas a las que quien consulta no tiene acceso. */
  movimientosExcluidosPorAcceso: number;
}

export interface FilaReporteCuenta {
  id: string;
  fecha: string;
  tipo: 'ingreso' | 'egreso' | 'transferencia';
  subtipo: 'pago' | 'adelanto' | 'cobro' | 'anticipo' | null;
  numero: number | null;
  numeroSistema: number | null;
  descripcion: string;
  referencia: string;
  /** Otra cuenta de una transferencia (o "Cuenta restringida"); null si no aplica. */
  cuentaContraria: string | null;
  categoriaId: string | null;
  /** Nombre ("Categoría › Subcategoría") y color, listos para imprimir; null = sin categoría. */
  categoria: { nombre: string; color: string } | null;
  /** Lo que entra a la cuenta (en su moneda). */
  entrada: number;
  /** Lo que sale de la cuenta (en su moneda). */
  salida: number;
  anulado: boolean;
  /** Transferencia con mesa de cambio cuyo saldo aún no llega a esta cuenta. */
  enProceso: boolean;
  /** Equivalente en USD del importe (solo cuentas en Bs), a la tasa del momento del movimiento; null = sin dato ni tasa. */
  equivalenteUsd?: number | null;
  /** Saldo de la cuenta (en su moneda) justo después de este movimiento; las filas anuladas no lo cambian. */
  saldo?: number;
}

export interface ReporteCuenta {
  banca: { id: string; nombre: string; moneda: string };
  desde: string;
  hasta: string;
  filas: FilaReporteCuenta[];
  totales: { entradas: number; salidas: number; neto: number };
  /** Saldo de la cuenta al empezar y al terminar el rango. */
  saldoInicial?: number;
  saldoFinal?: number;
}

/** Categoría de una nota de crédito/débito ya resuelta para mostrar. Espejo de backend/src/utils/categoria-nota.ts. */
export interface CategoriaDeNota {
  id: string;
  /** "Categoría › Subcategoría" o solo "Categoría". */
  nombre: string;
  color: string;
  imagenUrl: string | null;
}
