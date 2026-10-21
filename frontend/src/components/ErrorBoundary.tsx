import { Component, type ErrorInfo, type ReactNode } from 'react';
import { textoDeFallo } from '../lib/error-boundary-logica';

interface Props {
  children: ReactNode;
  /** 'completa' ocupa toda la pantalla (último recurso); 'pantalla' cabe dentro del Layout y deja visible el menú. */
  variante?: 'completa' | 'pantalla';
  /** Cuando cambia (p. ej. la ruta), un fallo previo se descarta y se vuelve a intentar mostrar el contenido. */
  resetKey?: string;
}

interface Estado {
  error: Error | null;
}

/** Evita la pantalla en blanco ante un error de render: muestra un aviso amable con Recargar y Volver al inicio. */
class ErrorBoundary extends Component<Props, Estado> {
  state: Estado = { error: null };

  static getDerivedStateFromError(error: Error): Estado {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Solo en desarrollo: en producción el usuario no ve (ni se registra en consola) texto técnico.
    if (import.meta.env.DEV) console.error('Error de render capturado por ErrorBoundary', error, info.componentStack);
  }

  componentDidUpdate(anterior: Props): void {
    if (this.state.error && anterior.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { titulo, detalle } = textoDeFallo(error);
    const contenedor = this.props.variante === 'completa' ? 'min-h-dvh bg-surface-alt' : 'flex-1';
    return (
      <div role="alert" className={`${contenedor} flex items-center justify-center p-8`}>
        <div className="text-center max-w-md">
          <h2 className="text-xl font-semibold text-text-primary mb-2">{titulo}</h2>
          <p className="text-text-secondary mb-4">{detalle}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button type="button" onClick={() => window.location.reload()} className="min-h-11 px-4 py-2 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700">
              Recargar
            </button>
            <button type="button" onClick={() => window.location.assign('/')} className="min-h-11 px-4 py-2 rounded-lg border border-border-strong text-text-primary font-medium hover:bg-surface-hover">
              Volver al inicio
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
