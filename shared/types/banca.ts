export type TipoBanca = 'banco_nacional' | 'banco_internacional' | 'exchange' | 'efectivo';

export interface Banca {
  id: string;
  nombre: string;
  tipo: TipoBanca;
  saldo: number;
  moneda: string;
  descripcion: string;
  archivada: boolean;
}
