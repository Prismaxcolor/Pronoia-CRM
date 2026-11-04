import { useCallback, useState, type ReactNode } from 'react';
import ToastContainer from '../components/Toast';
import { ToastContext, type Toast, type ToastTipo } from './use-toast-context';

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
