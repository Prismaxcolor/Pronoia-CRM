import { Pencil, EyeOff, Eye, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import type { Producto } from '@shared/types/index.js';

/** Permisos y manejadores compartidos por todas las filas y tarjetas. */
export interface AccionesComunes {
  puedeEditar: boolean;
  puedeBorrar: boolean;
  onMover: (id: string, direccion: 'arriba' | 'abajo') => void;
  onEditar: (p: Producto) => void;
  onDesactivar: (p: Producto) => void;
  onReactivar: (p: Producto) => void;
  onBorrar: (p: Producto) => void;
}

export interface AccionesProductoProps extends AccionesComunes {
  producto: Producto;
  esPrimero: boolean;
  esUltimo: boolean;
}

const BASE = 'p-1.5 rounded-md bg-surface-alt text-text-muted transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';

/** Botones de acción de un producto (mover, editar, desactivar/reactivar, borrar). Mismos permisos y mismas acciones
 *  que antes del rediseño; se usan en la tarjeta y en la tabla. */
function AccionesProducto({ producto: p, puedeEditar, puedeBorrar, esPrimero, esUltimo, onMover, onEditar, onDesactivar, onReactivar, onBorrar }: AccionesProductoProps) {
  return (
    <div className="flex gap-1">
      {puedeEditar && (
        <button type="button" onClick={() => onMover(p.id, 'arriba')} disabled={esPrimero} title="Mover arriba" aria-label={`Mover ${p.nombre} arriba`}
          className={`${BASE} hover:bg-brand-50 hover:text-brand-600 disabled:opacity-30 disabled:pointer-events-none`}>
          <ArrowUp size={13} />
        </button>
      )}
      {puedeEditar && (
        <button type="button" onClick={() => onMover(p.id, 'abajo')} disabled={esUltimo} title="Mover abajo" aria-label={`Mover ${p.nombre} abajo`}
          className={`${BASE} hover:bg-brand-50 hover:text-brand-600 disabled:opacity-30 disabled:pointer-events-none`}>
          <ArrowDown size={13} />
        </button>
      )}
      {puedeEditar && (
        <button type="button" onClick={() => onEditar(p)} title="Editar producto" aria-label={`Editar ${p.nombre}`}
          className={`${BASE} hover:bg-brand-50 hover:text-brand-600`}>
          <Pencil size={13} />
        </button>
      )}
      {puedeEditar && p.activo && (
        <button type="button" onClick={() => onDesactivar(p)} title="Desactivar" aria-label={`Desactivar ${p.nombre}`}
          className={`${BASE} hover:bg-amber-50 hover:text-amber-600`}>
          <EyeOff size={13} />
        </button>
      )}
      {puedeEditar && !p.activo && (
        <button type="button" onClick={() => onReactivar(p)} title="Reactivar" aria-label={`Reactivar ${p.nombre}`}
          className={`${BASE} hover:bg-brand-50 hover:text-brand-600`}>
          <Eye size={13} />
        </button>
      )}
      {puedeBorrar && (
        <button type="button" onClick={() => onBorrar(p)} title="Borrar definitivamente" aria-label={`Borrar ${p.nombre} definitivamente`}
          className={`${BASE} hover:bg-red-50 hover:text-red-600`}>
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

export default AccionesProducto;
