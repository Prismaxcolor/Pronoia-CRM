import { createContext, useContext } from 'react';

export type ConfirmVariant = 'default' | 'danger' | 'warning';

export interface ConfirmOpts {
  titulo: string;
  mensaje: string;
  confirmarLabel?: string;
  cancelarLabel?: string;
  variante?: ConfirmVariant;
}

export interface ConfirmContextType {
  confirmar: (opts: ConfirmOpts) => Promise<boolean>;
}

export const ConfirmContext = createContext<ConfirmContextType | null>(null);

export function useConfirm(): ConfirmContextType['confirmar'] {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm debe usarse dentro de ConfirmProvider');
  return ctx.confirmar;
}
