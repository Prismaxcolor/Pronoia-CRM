import { createContext, useContext } from 'react';

export type ToastTipo = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  tipo: ToastTipo;
  mensaje: string;
  duracionMs: number;
}

export interface ToastContextType {
  mostrar: (mensaje: string, tipo?: ToastTipo, duracionMs?: number) => void;
  exito: (mensaje: string) => void;
  errorMsg: (mensaje: string) => void;
  info: (mensaje: string) => void;
  advertencia: (mensaje: string) => void;
  cerrar: (id: string) => void;
}

export const ToastContext = createContext<ToastContextType | null>(null);

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast debe usarse dentro de ToastProvider');
  return ctx;
}
