import { useState } from 'react';
import { Pencil, X } from 'lucide-react';
import { Insignia, formatearKgDecimales, formatearNumero } from '../../components/ui';
import VisorFotos from '../../components/VisorFotos';
import LoteClasificacionEmbalado from './LoteClasificacionEmbalado';
import type { FilaLote } from '../../lib/almacenes-kpis';
import type { Lote } from '@shared/types/index.js';

interface Props {
  lote: Lote;
  fila: FilaLote;
  puedeEditar: boolean;
  /** Solo superadmin: cambiar la clase. */
  puedeConfigurar: boolean;
  onEditar: (lote: Lote) => void;
  onToggleActivo: (lote: Lote) => void;
  onCambio: () => void;
  onCerrar: () => void;
}

/** Detalle de UN lote: stock por almacén con su composición, productos ancla, fotos, clase y embalado.
 *  Conserva todas las acciones del panel anterior (editar, activar/desactivar, clase, embalar). */
function LoteDetalle({ lote, fila, puedeEditar, puedeConfigurar, onEditar, onToggleActivo, onCambio, onCerrar }: Props) {
  const [visor, setVisor] = useState<number | null>(null);
  return (
    <article className="rounded-xl border border-border bg-surface p-4 sm:p-5" aria-label={`Detalle del lote ${lote.nombre}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold text-text-primary">
            {lote.nombre}
            {!lote.activo && <Insignia tono="neutral">Inactivo</Insignia>}
          </h3>
          <p className={`text-2xl font-bold tabular-nums ${lote.stockKg < 0 ? 'text-red-700' : 'text-text-primary'}`}>
            {formatearKgDecimales(lote.stockKg, 2)}
            {lote.stockKg < 0 && <span className="ml-2 text-xs font-medium">stock negativo: revisar</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {puedeEditar && (
            <>
              <button
                type="button"
                onClick={() => onEditar(lote)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:border-brand-400 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                <Pencil size={14} aria-hidden="true" /> Editar lote
              </button>
              <button
                type="button"
                onClick={() => onToggleActivo(lote)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:border-brand-400 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                {lote.activo ? 'Desactivar' : 'Reactivar'}
              </button>
            </>
          )}
          <button type="button" onClick={onCerrar} aria-label="Cerrar detalle del lote" className="rounded-md p-1.5 text-text-muted hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <section aria-label="Dónde está el lote">
          <h4 className="mb-1.5 text-sm font-semibold text-text-primary">Dónde está</h4>
          {lote.stockPorAlmacen.length === 0 ? (
            <p className="text-sm text-text-muted">Este lote no tiene stock en ningún almacén todavía.</p>
          ) : (
            // Cada almacén tiene SU PROPIA composición — no es la misma en todos: cada uno acumula sus propias compras y
            // transformaciones por separado (ver docs/migration_lote_composicion_por_almacen.sql).
            <ul className="space-y-2">
              {lote.stockPorAlmacen.map(s => (
                <li key={s.almacenId} className="rounded-lg border border-border bg-surface-alt/50 p-2.5">
                  <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium text-text-primary">{s.almacenNombre}</span>
                    <span className="tabular-nums text-text-primary">{formatearKgDecimales(s.stockKg, 2)}</span>
                  </p>
                  {s.composicion.length > 0 && (
                    <p className="mt-1 flex flex-wrap gap-1">
                      {s.composicion.map(c => (
                        <span key={c.item} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
                          {c.item}: {formatearNumero(c.porcentaje, 0)} %
                        </span>
                      ))}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Producto ancla y fotos" className="space-y-4">
          <div>
            <h4 className="mb-1.5 text-sm font-semibold text-text-primary">Producto ancla</h4>
            {fila.ancla.length === 0 ? (
              <p className="text-sm text-text-muted">Ningún producto está anclado a este lote: al pesar se puede elegir cualquier producto.</p>
            ) : (
              <>
                <ul className="flex flex-wrap gap-1.5">
                  {fila.ancla.map(n => <li key={n}><Insignia tono="marca" icono={<span>★</span>}>{n}</Insignia></li>)}
                </ul>
                <p className="mt-1 text-xs text-text-secondary">Al pesar estos productos, este lote se ofrece primero como destino.</p>
              </>
            )}
          </div>
          {lote.fotos.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-sm font-semibold text-text-primary">Fotos</h4>
              <ul className="flex flex-wrap gap-2">
                {lote.fotos.map((f, i) => (
                  <li key={`${f}-${i}`}>
                    <button type="button" onClick={() => setVisor(i)} aria-label={`Ampliar foto ${i + 1} de ${lote.fotos.length}`} className="block h-16 w-16 overflow-hidden rounded-lg border border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                      <img src={f} alt="" loading="lazy" className="h-full w-full object-cover" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <LoteClasificacionEmbalado key={lote.id} lote={lote} puedeEditar={puedeEditar} puedeConfigurar={puedeConfigurar} onCambio={onCambio} />
      </div>

      {visor !== null && (
        <VisorFotos fotos={lote.fotos} indice={visor} onCambiar={setVisor} onCerrar={() => setVisor(null)} alt={`Foto del lote ${lote.nombre}`} />
      )}
    </article>
  );
}

export default LoteDetalle;
