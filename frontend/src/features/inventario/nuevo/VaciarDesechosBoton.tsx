/** Botón «Vaciar desechos»: solo aparece en la fila del producto DESECHOS (la basura que se lleva al vertedero).
 *  Pide confirmación, deja el producto en 0 kg registrando quién, cuándo y cuántos kg (ver vaciar_desechos en la BD)
 *  y avisa a la pantalla para que recargue. Exige el permiso toma_fisica:editar, igual que el servidor. */

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { formatearKg } from '../../../lib/inventario-nuevo';
import { vaciarDesechos } from '../../../services/inventario-service';
import { useAuth } from '../../../hooks/use-auth-context';
import { useConfirm } from '../../../hooks/use-confirm-context';
import { useToast } from '../../../hooks/use-toast-context';

export default function VaciarDesechosBoton({ productoId, kg, onVaciado }: { productoId: string; kg: number; onVaciado: () => void }) {
  const { tienePermiso } = useAuth();
  const confirmar = useConfirm();
  const toast = useToast();
  const [vaciando, setVaciando] = useState(false);
  if (!tienePermiso('toma_fisica', 'editar')) return null;

  const vaciar = async () => {
    const ok = await confirmar({
      titulo: 'Vaciar desechos',
      mensaje: `Se registrará que se botaron ${formatearKg(kg)} de desechos al vertedero y el producto quedará en 0 kg. Esta acción queda registrada con tu usuario y no se puede deshacer desde aquí.`,
      confirmarLabel: 'Vaciar desechos',
      variante: 'danger',
    });
    if (!ok) return;
    setVaciando(true);
    const r = await vaciarDesechos(productoId);
    setVaciando(false);
    if ('error' in r) { toast.errorMsg(r.error); return; }
    toast.exito(`Desechos vaciados: ${formatearKg(r.kgVaciados)}. El producto quedó en 0 kg.`);
    onVaciado();
  };

  return (
    <button
      type="button"
      onClick={vaciar}
      disabled={vaciando}
      title="Registrar que se botó la basura al vertedero y dejar este producto en 0 kg"
      className="mt-1 inline-flex items-center gap-1 rounded-md border border-red-200 bg-surface px-2 py-0.5 text-[11px] font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
    >
      <Trash2 size={12} aria-hidden="true" /> {vaciando ? 'Vaciando…' : 'Vaciar desechos'}
    </button>
  );
}
