import type { Lote } from '@shared/types/index.js';
import { formatearKgPesaje } from '../pesaje/pesaje-nuevo-logica';

/** Stock total del lote de origen y cuánto hay en cada almacén. */
export function StockLoteOrigen({ lote }: { lote: Lote }) {
  return (
    <>
      <p className="text-xs text-text-muted mt-1">Stock total (todos los almacenes): <span className="font-medium">{formatearKgPesaje(lote.stockKg)} kg</span></p>
      {lote.stockPorAlmacen.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {lote.stockPorAlmacen.map(s => (
            <span key={s.almacenId} className="text-[11px] bg-surface-alt border border-border rounded-full px-2 py-0.5 text-text-secondary">
              {s.almacenNombre}: {formatearKgPesaje(s.stockKg)} kg
            </span>
          ))}
        </div>
      )}
    </>
  );
}
