import { useId, useRef, useState } from 'react';
import { ChevronDown, Tag } from 'lucide-react';
import AvisoSinCategorias from './AvisoSinCategorias';
import HojaSelectorCategoria from './HojaSelectorCategoria';
import type { CategoriaWallet } from '@shared/types/index.js';
import { colorTextoSobre, opcionesParaTipo, type EleccionCategoria } from './categorias-logica';
import {
  eleccionDeTarjeta, tarjetasDeCategorias, valorTarjetaDeEleccion, type TarjetaCategoria,
} from './selector-categoria-tarjetas';

interface Props {
  tipo: 'ingreso' | 'egreso';
  categorias: readonly CategoriaWallet[];
  valor: EleccionCategoria;
  onChange: (e: EleccionCategoria) => void;
  /** Mensaje de error de validación (falta elegir). */
  error?: string | null;
}

const MINIATURA = 'h-10 w-10 shrink-0 overflow-hidden rounded-lg flex items-center justify-center text-base font-bold';

function Miniatura({ t }: { t: TarjetaCategoria | null }) {
  if (!t) return <span className={`${MINIATURA} bg-surface text-text-muted`} aria-hidden="true"><Tag size={18} /></span>;
  if (t.imagenUrl) return <img src={t.imagenUrl} alt="" loading="lazy" decoding="async" className={`${MINIATURA} bg-white object-cover`} />;
  return <span className={MINIATURA} style={{ backgroundColor: t.color, color: colorTextoSobre(t.color) }} aria-hidden="true">{t.inicial}</span>;
}

/**
 * Categoría (y subcategoría) de un ingreso o egreso. Muestra lo elegido en una tarjeta compacta y el botón
 * "Cambiar" abre las tarjetas para elegir. No hay valor predeterminado: hay que elegir una categoría o la
 * opción explícita "Sin categoría".
 */
function SelectorCategoria({ tipo, categorias, valor, onChange, error }: Props) {
  const base = useId();
  const [abierta, setAbierta] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const sinCategorias = opcionesParaTipo(categorias, tipo).length === 0;
  const marcado = valorTarjetaDeEleccion(valor);
  const elegida = typeof marcado === 'string' && marcado !== ''
    ? tarjetasDeCategorias(categorias, { tipoMovimiento: tipo, soloIds: [marcado] })[0] ?? null
    : null;
  const sinElegir = marcado === '';
  const idError = `${base}-err`;
  const cerrar = () => { setAbierta(false); boton.current?.focus(); };
  const elegir = (id: string | null) => { onChange(eleccionDeTarjeta(id, categorias)); cerrar(); };

  const nombre = elegida ? elegida.nombre : marcado === null ? 'Sin categoría' : sinCategorias ? 'Sin categorías disponibles' : 'Elige una categoría';
  const detalle = elegida?.padreNombre ? `en ${elegida.padreNombre}` : null;

  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-text-secondary">Categoría</span>
      <div className={`flex items-center gap-3 rounded-lg border bg-surface-alt p-2 ${error ? 'border-red-400' : 'border-border'}`}>
        <Miniatura t={elegida} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm ${sinElegir ? 'text-text-muted' : 'text-text-primary'}`}>{nombre}</span>
          {detalle && <span className="block truncate text-xs text-text-muted">{detalle}</span>}
        </span>
        <button
          ref={boton}
          type="button"
          onClick={() => setAbierta(true)}
          disabled={sinCategorias}
          aria-haspopup="dialog"
          aria-describedby={error ? idError : undefined}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-text-secondary hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50"
        >
          {sinElegir ? 'Elegir' : 'Cambiar'}<ChevronDown size={14} aria-hidden="true" />
        </button>
      </div>
      {sinCategorias && <p className="mt-1 text-xs text-text-muted"><AvisoSinCategorias /></p>}
      {error && <p id={idError} role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
      {abierta && <HojaSelectorCategoria tipo={tipo} categorias={categorias} valor={marcado} onElegir={elegir} onClose={cerrar} />}
    </div>
  );
}

export default SelectorCategoria;
