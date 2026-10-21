export type TipoBanca = 'banco_nacional' | 'banco_internacional' | 'exchange' | 'efectivo';

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
}
