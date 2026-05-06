import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import ToastContainer from '../components/Toast';

export type ToastTipo = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  tipo: ToastTipo;
  mensaje: string;
  duracionMs: number;
}

interface ToastContextType {
  mostrar: (mensaje: string, tipo?: ToastTipo, duracionMs?: number) => void;
  exito: (mensaje: string) => void;
  errorMsg: (mensaje: string) => void;
  info: (mensaje: string) => void;
  advertencia: (mensaje: string) => void;
  cerrar: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

const DEFAULT_DURATION = 4000;
const ERROR_DURATION = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const cerrar = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const mostrar = useCallback((mensaje: string, tipo: ToastTipo = 'info', duracionMs?: number) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const duracion = duracionMs ?? (tipo === 'error' ? ERROR_DURATION : DEFAULT_DURATION);
    setToasts(prev => [...prev, { id, tipo, mensaje, duracionMs: duracion }]);
    if (duracion > 0) {
      window.setTimeout(() => cerrar(id), duracion);
    }
  }, [cerrar]);

  const exito = useCallback((m: string) => mostrar(m, 'success'), [mostrar]);
  const errorMsg = useCallback((m: string) => mostrar(m, 'error'), [mostrar]);
  const info = useCallback((m: string) => mostrar(m, 'info'), [mostrar]);
  const advertencia = useCallback((m: string) => mostrar(m, 'warning'), [mostrar]);

  return (
    <ToastContext.Provider value={{ mostrar, exito, errorMsg, info, advertencia, cerrar }}>
      {children}
      <ToastContainer toasts={toasts} onClose={cerrar} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast debe usarse dentro de ToastProvider');
  return ctx;
}
