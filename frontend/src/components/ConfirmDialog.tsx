import { useEffect, useRef } from 'react';
import { AlertTriangle, AlertOctagon, HelpCircle, X } from 'lucide-react';
import type { ConfirmVariant } from '../hooks/use-confirm';

interface VariantStyles {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  confirmBg: string;
}

const VARIANTES: Record<ConfirmVariant, VariantStyles> = {
  default: {
    icon: <HelpCircle size={22} />,
    iconBg: 'bg-brand-50',
    iconColor: 'text-brand-600',
    confirmBg: 'bg-brand-600 hover:bg-brand-700 active:bg-brand-800',
  },
  warning: {
    icon: <AlertTriangle size={22} />,
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    confirmBg: 'bg-amber-600 hover:bg-amber-700 active:bg-amber-800',
  },
  danger: {
    icon: <AlertOctagon size={22} />,
    iconBg: 'bg-red-50',
    iconColor: 'text-red-600',
    confirmBg: 'bg-red-600 hover:bg-red-700 active:bg-red-800',
  },
};

interface Props {
  abierto: boolean;
  titulo: string;
  mensaje: string;
  confirmarLabel: string;
  cancelarLabel: string;
  variante: ConfirmVariant;
  onConfirmar: () => void;
  onCancelar: () => void;
}

function ConfirmDialog({
  abierto,
  titulo,
  mensaje,
  confirmarLabel,
  cancelarLabel,
  variante,
  onConfirmar,
  onCancelar,
}: Props) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  // foco al botón confirmar al abrir + cierre con ESC
  useEffect(() => {
    if (!abierto) return;
    confirmBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancelar();
      if (e.key === 'Enter') onConfirmar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [abierto, onCancelar, onConfirmar]);

  if (!abierto) return null;

  const cfg = VARIANTES[variante];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-titulo"
      className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/50 animate-[fade-in_0.15s_ease-out]"
      onClick={onCancelar}
    >
      <div
        className="bg-surface rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-[scale-in_0.18s_ease-out]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-4 p-5">
          <div className={`shrink-0 w-11 h-11 rounded-full flex items-center justify-center ${cfg.iconBg} ${cfg.iconColor}`}>
            {cfg.icon}
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <h2 id="confirm-titulo" className="text-base font-bold text-text-primary leading-tight">
              {titulo}
            </h2>
            <p className="text-sm text-text-secondary mt-1.5 leading-relaxed whitespace-pre-line">
              {mensaje}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelar}
            className="shrink-0 text-text-muted hover:text-text-primary transition-colors -mt-1 -mr-1 p-1"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-3 px-5 py-4 bg-surface-alt border-t border-border">
          <button
            type="button"
            onClick={onCancelar}
            className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors"
          >
            {cancelarLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={onConfirmar}
            className={`flex-1 py-2.5 text-white rounded-lg text-sm font-medium transition-colors ${cfg.confirmBg}`}
          >
            {confirmarLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
