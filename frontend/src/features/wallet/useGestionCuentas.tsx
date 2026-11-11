import { useCallback, useState, type ReactNode } from 'react';
import type { Banca } from '@shared/types/index.js';
import { archivarBanca, desarchivarBanca } from '../../services/banca-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { useConfirm } from '../../hooks/use-confirm-context';
import BancaFormModal from '../cochinito/BancaFormModal';
import { puedeEditarBanca } from '../usuarios/acceso-bancas';

type EstadoModal = { banca: Banca | null } | null;

export interface GestionCuentas {
  puedeCrear: boolean;
  /** Permiso global de editar + acceso de edición a esa cuenta (Banca.puedeEditar !== false). */
  puedeEditarCuenta: (b: Banca) => boolean;
  puedeArchivarCuenta: (b: Banca) => boolean;
  abrirNueva: () => void;
  abrirEditar: (b: Banca) => void;
  archivar: (b: Banca) => Promise<void>;
  restaurar: (b: Banca) => Promise<void>;
  /** Modal de crear/editar cuenta: va una sola vez en la pantalla. */
  modal: ReactNode;
}

interface Opciones {
  /** Todas las cuentas conocidas: de ahí salen los grupos de Telegram ya usados. */
  cuentas: readonly Banca[];
  /** Recarga las cuentas tras guardar, archivar o restaurar. */
  recargar: () => void;
  /** Se llama tras archivar con éxito (p. ej. para salir del detalle de esa cuenta). */
  alArchivar?: (b: Banca) => void;
}

/** Crear, editar, archivar y restaurar cuentas con los mismos permisos, confirmaciones y mensajes de la Wallet clásica. */
export function useGestionCuentas({ cuentas, recargar, alArchivar }: Opciones): GestionCuentas {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const confirmar = useConfirm();
  const [formulario, setFormulario] = useState<EstadoModal>(null);
  const puedeCrear = tienePermiso('cochinito', 'crear');
  const puedeEditar = tienePermiso('cochinito', 'editar');
  const puedeArchivar = tienePermiso('cochinito', 'eliminar');

  const archivar = useCallback(async (b: Banca) => {
    const ok = await confirmar({
      titulo: `Archivar la cuenta "${b.nombre}"`,
      mensaje: 'Podrás restaurarla más adelante. El histórico de movimientos se conserva intacto.',
      confirmarLabel: 'Archivar',
      variante: 'warning',
    });
    if (!ok) return;
    const r = await archivarBanca(b.id);
    if (!r.ok) { toast.errorMsg(r.razon ?? 'No se pudo archivar la cuenta.'); return; }
    toast.exito(`Cuenta "${b.nombre}" archivada.`);
    recargar();
    alArchivar?.(b);
  }, [confirmar, toast, recargar, alArchivar]);

  const restaurar = useCallback(async (b: Banca) => {
    if (!(await desarchivarBanca(b.id))) { toast.errorMsg('No se pudo restaurar la cuenta.'); return; }
    toast.exito(`Cuenta "${b.nombre}" restaurada.`);
    recargar();
  }, [toast, recargar]);

  const onGuardado = (modo: 'crear' | 'editar') => {
    setFormulario(null);
    toast.exito(modo === 'crear' ? 'Cuenta creada.' : 'Cuenta actualizada.');
    recargar();
  };

  return {
    puedeCrear,
    puedeEditarCuenta: b => puedeEditar && puedeEditarBanca(b),
    puedeArchivarCuenta: b => puedeArchivar && puedeEditarBanca(b),
    abrirNueva: () => setFormulario({ banca: null }),
    abrirEditar: b => setFormulario({ banca: b }),
    archivar,
    restaurar,
    modal: formulario
      ? <BancaFormModal banca={formulario.banca} bancas={[...cuentas]} onClose={() => setFormulario(null)} onGuardado={onGuardado} />
      : null,
  };
}
