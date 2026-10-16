import { useEffect } from 'react';

/** ¿Esta tecla debe cerrar el modal? Escape, salvo que otro control ya la haya atendido o se esté guardando. */
export function debeCerrarConTecla(tecla: string, yaAtendida: boolean, bloqueado: boolean): boolean {
  return tecla === 'Escape' && !yaAtendida && !bloqueado;
}

/**
 * Cierra un modal con la tecla Escape (equivale al botón Cancelar). `bloqueado` la ignora, p. ej. mientras se guarda.
 * `prioritario` es para un modal anidado (selector dentro de otro modal): escucha en la fase de captura y detiene la
 * tecla, de modo que Escape cierra solo el de encima y no el modal padre.
 */
export function useCerrarConEscape(onClose: () => void, bloqueado = false, prioritario = false): void {
  useEffect(() => {
    const alTecla = (e: KeyboardEvent) => {
      if (!debeCerrarConTecla(e.key, e.defaultPrevented, bloqueado)) return;
      if (prioritario) { e.preventDefault(); e.stopPropagation(); }
      onClose();
    };
    document.addEventListener('keydown', alTecla, prioritario);
    return () => document.removeEventListener('keydown', alTecla, prioritario);
  }, [onClose, bloqueado, prioritario]);
}
