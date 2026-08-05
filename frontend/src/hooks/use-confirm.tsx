import { useCallback, useRef, useState, type ReactNode } from 'react';
import ConfirmDialog from '../components/ConfirmDialog';
import { ConfirmContext, type ConfirmOpts } from './use-confirm-context';

interface DialogState extends ConfirmOpts {
  abierto: boolean;
}

const ESTADO_INICIAL: DialogState = {
  abierto: false,
  titulo: '',
  mensaje: '',
};

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<DialogState>(ESTADO_INICIAL);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const confirmar = useCallback((opts: ConfirmOpts): Promise<boolean> => {
    return new Promise<boolean>(resolve => {
      resolverRef.current = resolve;
      setEstado({ ...opts, abierto: true });
    });
  }, []);

  const cerrar = useCallback((respuesta: boolean) => {
    resolverRef.current?.(respuesta);
    resolverRef.current = null;
    setEstado(prev => ({ ...prev, abierto: false }));
  }, []);

  return (
    <ConfirmContext.Provider value={{ confirmar }}>
      {children}
      <ConfirmDialog
        abierto={estado.abierto}
        titulo={estado.titulo}
        mensaje={estado.mensaje}
        confirmarLabel={estado.confirmarLabel ?? 'Confirmar'}
        cancelarLabel={estado.cancelarLabel ?? 'Cancelar'}
        variante={estado.variante ?? 'default'}
        onConfirmar={() => cerrar(true)}
        onCancelar={() => cerrar(false)}
      />
    </ConfirmContext.Provider>
  );
}
