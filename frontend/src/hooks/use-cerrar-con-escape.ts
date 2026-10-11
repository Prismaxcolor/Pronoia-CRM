import { useEffect } from 'react';

/** ¿Esta tecla debe cerrar el modal? Escape, salvo que otro control ya la haya atendido o se esté guardando. */
export function debeCerrarConTecla(tecla: string, yaAtendida: boolean, bloqueado: boolean): boolean {
  return tecla === 'Escape' && !yaAtendida && !bloqueado;
}

/** Cierra un modal con la tecla Escape (equivale al botón Cancelar). `bloqueado` la ignora, p. ej. mientras se guarda. */
export function useCerrarConEscape(onClose: () => void, bloqueado = false): void {
  useEffect(() => {
    const alTecla = (e: KeyboardEvent) => { if (debeCerrarConTecla(e.key, e.defaultPrevented, bloqueado)) onClose(); };
    document.addEventListener('keydown', alTecla);
    return () => document.removeEventListener('keydown', alTecla);
  }, [onClose, bloqueado]);
}
