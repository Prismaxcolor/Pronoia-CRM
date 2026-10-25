export type TipoBanca = 'banco_nacional' | 'banco_internacional' | 'exchange' | 'efectivo';

/** Regla de comisión automática de una cuenta: se carga sola en cada salida de dinero (comision_auto_* en bancas). */
export interface ComisionAutomaticaBanca {
  /** Fracción del monto: 0.003 = 0.3 %. 0 si la comisión es solo un monto fijo. */
  tasa: number;
  /** Comisión mínima, en la moneda de la cuenta. 0 si es solo porcentaje. */
  minimo: number;
}

export interface Banca {
  id: string;
  nombre: string;
  tipo: TipoBanca;
  saldo: number;
  moneda: string;
  descripcion: string;
  archivada: boolean;
  /** Clave de la paleta (lib/color-banca) o hex #RRGGBB; null = sin color. */
  color?: string | null;
  /** Chat de Telegram al que van los avisos de esta banca; null = grupo general de cajas. */
  telegramChatId?: string | null;
  /** false = el superadmin apagó los avisos de Telegram de los movimientos de esta cuenta; ausente = activos. */
  telegramReportesActivos?: boolean;
  /** URL pública de la imagen de la cuenta (logo / foto de la caja); null o ausente = sin imagen. */
  imagenUrl?: string | null;
  /**
   * Solo en GET /cochinito/bancas: false = el usuario tiene acceso de solo consulta (no puede registrar
   * movimientos, pagos ni cobros con esta cuenta). Ausente = sin información (se asume editable).
   */
  puedeEditar?: boolean;
  /** Comisión automática de la cuenta; null o ausente = sin comisión automática (o migración sin aplicar). */
  comisionAuto?: ComisionAutomaticaBanca | null;
}
