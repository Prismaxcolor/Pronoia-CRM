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
}
