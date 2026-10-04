import { Archive, ArchiveRestore, Building2, Coins, Globe, Pencil, Wallet } from 'lucide-react';
import { Insignia, formatearNumero } from '../../components/ui';
import type { Banca, TipoBanca } from '@shared/types/index.js';

const ICONO_TIPO: Record<TipoBanca, React.ReactNode> = {
  banco_nacional: <Building2 size={16} />,
  banco_internacional: <Globe size={16} />,
  exchange: <Coins size={16} />,
  efectivo: <Wallet size={16} />,
};

const ETIQUETA_TIPO: Record<TipoBanca, string> = {
  banco_nacional: 'Nacional',
  banco_internacional: 'Internacional',
  exchange: 'Exchange',
  efectivo: 'Efectivo',
};

const BOTON_ACCION = 'rounded-md border border-border bg-surface p-2 text-text-secondary hover:bg-surface-hover hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';

interface Props {
  banca: Banca;
  /** La banca está usada como filtro de la tabla de movimientos. */
  seleccionada: boolean;
  onAlternarFiltro: () => void;
  /** Cada acción solo se pasa si el usuario tiene el permiso (la misma condición que antes). */
  onEditar?: () => void;
  onArchivar?: () => void;
  onDesarchivar?: () => void;
}

/** Tarjeta de una banca: saldo con su unidad, tipo, filtro por clic y acciones de editar/archivar/restaurar. */
function TarjetaBanca({ banca, seleccionada, onAlternarFiltro, onEditar, onArchivar, onDesarchivar }: Props) {
  const negativo = banca.saldo < 0;
  const simbolo = banca.moneda === 'USD' ? 'USD' : banca.moneda === 'VES' ? 'Bs' : banca.moneda;
  const hayAcciones = Boolean(onEditar || onArchivar || onDesarchivar);
  return (
    <article className={`rounded-xl border bg-surface p-4 ${banca.archivada ? 'opacity-70' : ''} ${seleccionada ? 'border-brand-500 ring-2 ring-brand-200' : 'border-border'}`}>
      <button
        type="button"
        onClick={onAlternarFiltro}
        aria-pressed={seleccionada}
        title={seleccionada ? 'Quitar el filtro por esta banca' : 'Ver solo los movimientos de esta banca'}
        className="w-full rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700" aria-hidden="true">{ICONO_TIPO[banca.tipo]}</span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-text-primary">{banca.nombre}</h3>
            <p className="text-xs text-text-secondary">{ETIQUETA_TIPO[banca.tipo]} · {banca.moneda}</p>
          </div>
          {banca.archivada && <Insignia forma="cuadrada" icono={<Archive size={10} />}>Archivada</Insignia>}
        </div>
        {banca.descripcion && <p className="mt-2 line-clamp-1 text-xs text-text-secondary">{banca.descripcion}</p>}
        <p className={`mt-3 text-2xl font-bold tabular-nums ${negativo ? 'text-amber-800' : 'text-text-primary'}`}>
          {simbolo} {formatearNumero(banca.saldo, 2)}
        </p>
        <p className="mt-0.5 text-xs text-text-secondary">
          {negativo ? 'Saldo en negativo: se han registrado más egresos que ingresos.' : 'Saldo actual de la banca'}
        </p>
      </button>
      {hayAcciones && (
        <div className="mt-3 flex gap-2 border-t border-border pt-3">
          {onEditar && !banca.archivada && (
            <button type="button" onClick={onEditar} className={BOTON_ACCION} title="Editar banca" aria-label={`Editar la banca ${banca.nombre}`}>
              <Pencil size={14} aria-hidden="true" />
            </button>
          )}
          {onArchivar && !banca.archivada && (
            <button type="button" onClick={onArchivar} className={BOTON_ACCION} title="Archivar banca" aria-label={`Archivar la banca ${banca.nombre}`}>
              <Archive size={14} aria-hidden="true" />
            </button>
          )}
          {onDesarchivar && banca.archivada && (
            <button type="button" onClick={onDesarchivar} className={BOTON_ACCION} title="Restaurar banca" aria-label={`Restaurar la banca ${banca.nombre}`}>
              <ArchiveRestore size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export default TarjetaBanca;
