import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import SeleccionarEntidadModal from '../../components/SeleccionarEntidadModal';
import { entidadesDeBancas, inicialDeBanca, type EntidadBanca } from './selector-banca';
import type { Banca } from '@shared/types/index.js';

interface Props {
  /** Cuentas que se ofrecen (el llamador ya filtró editables / archivadas / ya usadas). */
  bancas: readonly Banca[];
  valor: string;
  onChange: (bancaId: string) => void;
  /** Título del panel de tarjetas (ej. "Elegir cuenta o caja"). */
  titulo?: string;
  placeholder?: string;
  /** Muestra el saldo en cada tarjeta (por defecto sí). */
  conSaldo?: boolean;
  ariaLabel?: string;
  className?: string;
}

const MINIATURA = 'h-9 w-9 shrink-0 rounded-lg overflow-hidden flex items-center justify-center text-white text-sm font-bold';

/** Miniatura de la cuenta: su imagen, o la inicial sobre su color. */
function Miniatura({ entidad }: { entidad: EntidadBanca }) {
  if (entidad.fotos[0]) {
    return <img src={entidad.fotos[0]} alt="" loading="lazy" decoding="async" className={`${MINIATURA} object-cover bg-surface-alt`} />;
  }
  return <span aria-hidden="true" className={MINIATURA} style={{ backgroundColor: entidad.color }}>{inicialDeBanca(entidad.nombre)}</span>;
}

/**
 * Selector de cuenta/caja con imagen: botón que muestra la elegida y abre el mismo panel de tarjetas
 * que los materiales de Pesaje (SeleccionarEntidadModal). Sin imagen, la tarjeta muestra color e inicial.
 */
function SelectorBanca({ bancas, valor, onChange, titulo = 'Elegir cuenta o caja', placeholder = '— Selecciona —', conSaldo = true, ariaLabel, className = '' }: Props) {
  const [abierto, setAbierto] = useState(false);
  const entidades = useMemo(() => entidadesDeBancas(bancas, conSaldo), [bancas, conSaldo]);
  const actual = entidades.find(e => e.id === valor);

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label={ariaLabel ?? titulo}
        aria-haspopup="dialog"
        className={`flex w-full items-center gap-2 rounded-lg border border-border bg-surface-alt px-2 py-1.5 text-left text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 ${className}`}
      >
        {actual ? (
          <>
            <Miniatura entidad={actual} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-text-primary">{actual.nombre}</span>
              <span className="block truncate text-xs text-text-muted">{actual.detalle}</span>
            </span>
          </>
        ) : (
          <span className="flex-1 px-1 py-1.5 text-text-muted">{placeholder}</span>
        )}
        <ChevronDown size={16} className="shrink-0 text-text-muted" aria-hidden="true" />
      </button>
      {abierto && (
        <SeleccionarEntidadModal
          titulo={titulo}
          entidades={entidades}
          seleccionadoId={valor}
          mensajeVacio="No hay cuentas o cajas disponibles."
          tamanoTarjeta="compacto"
          renderSinFoto={e => (
            <span className="flex h-full w-full items-center justify-center text-4xl font-bold text-white" style={{ backgroundColor: e.color }}>
              {inicialDeBanca(e.nombre)}
            </span>
          )}
          onClose={() => setAbierto(false)}
          onSeleccionar={id => { onChange(id); setAbierto(false); }}
        />
      )}
    </>
  );
}

export default SelectorBanca;
