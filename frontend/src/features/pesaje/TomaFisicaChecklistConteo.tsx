import { CheckCircle2, Circle } from 'lucide-react';
import { Bloque, BarraProgreso, EstadoVacio, Insignia, formatearNumero } from '../../components/ui';
import { avanceConteo, clasificarDiferencia } from '../../lib/toma-fisica-kpis';
import type { ResumenTomaFisicaLinea } from '@shared/types/index.js';

/** Avance y checklist del conteo físico: barra de progreso + lista táctil (filas de 48 px) de materiales o lotes con su
 *  teórico, lo contado y el resultado en texto. Solo presentación: elegir una fila llama a `onElegir` (la pantalla
 *  decide qué carga en el formulario). */

const kg = (n: number) => formatearNumero(n, 2);

interface Props {
  lineas: readonly ResumenTomaFisicaLinea[];
  esConLote: boolean;
  /** Id (producto o lote, según el alcance) actualmente cargado en el formulario. */
  seleccionadoId: string;
  onElegir: (linea: ResumenTomaFisicaLinea) => void;
}

function TomaFisicaChecklistConteo({ lineas, esConLote, seleccionadoId, onElegir }: Props) {
  const avance = avanceConteo(lineas);
  const unidad = esConLote ? 'lotes' : 'productos';

  return (
    <Bloque
      titulo="Avance del conteo"
      queEstasViendo={`Cuántos ${unidad} de esta toma ya tienen al menos un pesaje. «Teórico» es lo que dice el sistema y «Real» lo que ya contaste. Toca uno de la lista para cargarlo en el formulario de abajo.`}
    >
      {lineas.length === 0 ? (
        <EstadoVacio
          mensaje={`Esta toma no tiene ${unidad} para contar.`}
          descripcion="Revisa que el almacén y las categorías (o lotes) elegidos al crear la toma tengan material."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="border-b border-border p-4">
            <p className="flex items-baseline justify-between gap-2">
              <span className="text-2xl font-bold tabular-nums text-text-primary">
                {formatearNumero(avance.contadas, 0)} de {formatearNumero(avance.total, 0)} <span className="text-sm font-medium text-text-secondary">{unidad} contados</span>
              </span>
              <span className="text-sm font-medium tabular-nums text-text-secondary">{formatearNumero(avance.pct, 0)} %</span>
            </p>
            <div className="mt-2">
              <BarraProgreso valor={avance.contadas} max={avance.total} etiqueta={`Avance del conteo: ${avance.contadas} de ${avance.total} ${unidad}`} tono={avance.faltan === 0 ? 'exito' : 'marca'} alto="h-4" />
            </div>
            <p className="mt-1.5 text-xs text-text-secondary">
              {avance.faltan === 0 ? 'Todo contado: ya puedes cerrar la toma desde su detalle.' : `Faltan ${formatearNumero(avance.faltan, 0)} por contar.`}
            </p>
          </div>
          <ul className="max-h-80 divide-y divide-border overflow-y-auto">
            {lineas.map(l => {
              const contado = l.cantidadPesajes > 0;
              const idLinea = (esConLote ? l.loteId : l.productoId) ?? '';
              const seleccionada = seleccionadoId === idLinea && idLinea !== '';
              const nombre = esConLote ? l.loteNombre : l.productoNombre;
              const s = clasificarDiferencia(l);
              return (
                <li key={idLinea || nombre}>
                  <button
                    type="button"
                    onClick={() => onElegir(l)}
                    aria-pressed={seleccionada}
                    className={`flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-surface-alt focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400 ${seleccionada ? 'bg-brand-50' : ''}`}
                  >
                    {contado
                      ? <CheckCircle2 size={20} className="shrink-0 text-brand-600" aria-label="Contado" />
                      : <Circle size={20} className="shrink-0 text-text-muted" aria-label="Sin contar" />}
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate ${contado ? 'font-medium text-text-primary' : 'text-text-secondary'}`}>{nombre}</span>
                      <span className="block text-xs tabular-nums text-text-secondary">
                        Teórico {kg(l.stockTeorico)} kg{contado ? ` · Real ${kg(l.stockReal)} kg` : ''}
                      </span>
                    </span>
                    <span className="shrink-0"><Insignia tono={s.tono}>{s.etiqueta}</Insignia></span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Bloque>
  );
}

export default TomaFisicaChecklistConteo;
