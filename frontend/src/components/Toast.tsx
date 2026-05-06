import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';
import type { Toast, ToastTipo } from '../hooks/use-toast';

interface IconConfig {
  icon: React.ReactNode;
  borderClass: string;
  iconWrapClass: string;
}

const CONFIG: Record<ToastTipo, IconConfig> = {
  success: {
    icon: <CheckCircle2 size={18} />,
    borderClass: 'border-l-green-500',
    iconWrapClass: 'text-green-600 bg-green-50',
  },
  error: {
    icon: <XCircle size={18} />,
    borderClass: 'border-l-red-500',
    iconWrapClass: 'text-red-600 bg-red-50',
  },
  warning: {
    icon: <AlertTriangle size={18} />,
    borderClass: 'border-l-amber-500',
    iconWrapClass: 'text-amber-600 bg-amber-50',
  },
  info: {
    icon: <Info size={18} />,
    borderClass: 'border-l-brand-500',
    iconWrapClass: 'text-brand-600 bg-brand-50',
  },
};

interface Props {
  toasts: Toast[];
  onClose: (id: string) => void;
}

function ToastContainer({ toasts, onClose }: Props) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)] sm:w-96 pointer-events-none">
      {toasts.map(t => {
        const cfg = CONFIG[t.tipo];
        return (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto bg-surface rounded-lg shadow-lg border border-border border-l-4 ${cfg.borderClass} p-3 flex items-start gap-3 animate-[slide-in_0.2s_ease-out]`}
          >
            <div className={`shrink-0 p-1.5 rounded-md ${cfg.iconWrapClass}`}>
              {cfg.icon}
            </div>
            <p className="flex-1 text-sm text-text-primary leading-snug pt-0.5">{t.mensaje}</p>
            <button
              type="button"
              onClick={() => onClose(t.id)}
              className="shrink-0 text-text-muted hover:text-text-primary transition-colors p-0.5"
              aria-label="Cerrar"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default ToastContainer;
