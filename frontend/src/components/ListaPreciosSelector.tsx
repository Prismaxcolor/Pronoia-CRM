import { useEffect, useState } from 'react';
import {
  obtenerListasParaProducto,
  type ListaParaProducto,
} from '../services/lista-precios-service';

interface Props {
  /** Material para el que se buscan listas con precio. */
  productoId: string;
  /** Id de la lista seleccionada (controlado). */
  value?: string | null;
  /**
   * Se dispara al elegir una lista. Devuelve el id de la lista y el precio que
   * esa lista define para el material (listo para precargar en la factura).
   */
  onChange: (listaId: string | null, precio: number | null) => void;
  className?: string;
  disabled?: boolean;
}

/**
 * Dropdown que muestra las listas de precios ACTIVAS que tienen un precio
 * definido para `productoId`. Pensado para los formularios de factura:
 * "¿con qué lista vas a facturar este material?".
 */
function ListaPreciosSelector({ productoId, value, onChange, className, disabled }: Props) {
  const [listas, setListas] = useState<ListaParaProducto[]>([]);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!productoId) {
      setListas([]);
      return;
    }
    let activo = true;
    setCargando(true);
    obtenerListasParaProducto(productoId)
      .then(data => { if (activo) setListas(data); })
      .finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
  }, [productoId]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const listaId = e.target.value || null;
    const seleccionada = listas.find(l => l.listaId === listaId);
    onChange(listaId, seleccionada ? seleccionada.precio : null);
  };

  const baseClass =
    'w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent disabled:opacity-50';

  if (!productoId) {
    return (
      <select disabled className={`${baseClass} ${className ?? ''}`}>
        <option>Elige primero un material</option>
      </select>
    );
  }

  if (cargando) {
    return (
      <select disabled className={`${baseClass} ${className ?? ''}`}>
        <option>Cargando listas...</option>
      </select>
    );
  }

  if (listas.length === 0) {
    return (
      <select disabled className={`${baseClass} ${className ?? ''}`}>
        <option>Sin listas con precio para este material</option>
      </select>
    );
  }

  return (
    <select
      value={value ?? ''}
      onChange={handleChange}
      disabled={disabled}
      className={`${baseClass} ${className ?? ''}`}
    >
      <option value="">Sin lista (precio manual)</option>
      {listas.map(l => (
        <option key={l.listaId} value={l.listaId}>
          {l.nombre} — {l.precio}/kg
        </option>
      ))}
    </select>
  );
}

export default ListaPreciosSelector;
