import { Plus, Trash2 } from 'lucide-react';
import { COLORES_LOTE, calcularNeto, errorFila, formatearPeso, parsearPeso } from '../../lib/packing-list';

/** Fila en edición: todo es texto mientras se escribe; se interpreta con parsearPeso al guardar. */
export interface FilaForm {
  clave: string;
  numeroPaleta: string;
  lote: string;
  color: string;
  pesoBruto: string;
  pesoPaleta: string;
}

interface Props {
  filas: FilaForm[];
  esPcb: boolean;
  nombreBulto: string;
  puedeEditar: boolean;
  onCambiar: (clave: string, campo: keyof Omit<FilaForm, 'clave'>, valor: string) => void;
  onQuitar: (clave: string) => void;
  onAgregar: () => void;
}

const INPUT = 'w-full px-2 py-1.5 bg-surface-alt border border-border rounded-md text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-70';
const TH = 'px-2 py-2 text-left text-xs font-semibold text-text-secondary whitespace-nowrap';

function mensajeFila(f: FilaForm): string | null {
  return errorFila({
    numero: 1,
    numeroPaleta: null,
    lote: null,
    color: null,
    pesoBruto: parsearPeso(f.pesoBruto),
    pesoPaleta: f.pesoPaleta.trim() === '' ? 0 : parsearPeso(f.pesoPaleta),
  });
}

function PackingListFilas({ filas, esPcb, nombreBulto, puedeEditar, onCambiar, onQuitar, onAgregar }: Props) {
  const campo = (f: FilaForm, k: keyof Omit<FilaForm, 'clave'>, etiqueta: string, extra = '') => (
    <input
      aria-label={`${etiqueta} (fila ${filas.indexOf(f) + 1})`}
      value={f[k]}
      disabled={!puedeEditar}
      inputMode={k === 'lote' ? 'text' : 'decimal'}
      onChange={e => onCambiar(f.clave, k, e.target.value)}
      className={`${INPUT} ${extra}`}
    />
  );

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>{nombreBulto}</th>
              {esPcb && <th className={TH}>Lote</th>}
              {esPcb && <th className={TH}>Color</th>}
              <th className={TH}>N.º de paleta</th>
              <th className={`${TH} text-right`}>Peso bruto (kg)</th>
              <th className={`${TH} text-right`}>Peso de la paleta (kg)</th>
              <th className={`${TH} text-right`}>Peso neto (kg)</th>
              <th className={TH}><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => {
              const error = mensajeFila(f);
              return (
                <tr key={f.clave} className="border-b border-border/60 align-top">
                  <td className="px-2 py-1.5 tabular-nums text-text-secondary">{i + 1}</td>
                  {esPcb && <td className="px-2 py-1.5 w-24">{campo(f, 'lote', 'Lote')}</td>}
                  {esPcb && (
                    <td className="px-2 py-1.5 w-32">
                      <select
                        aria-label={`Color (fila ${i + 1})`}
                        value={f.color}
                        disabled={!puedeEditar}
                        onChange={e => onCambiar(f.clave, 'color', e.target.value)}
                        className={INPUT}
                      >
                        <option value="">—</option>
                        {COLORES_LOTE.map(c => <option key={c.clave} value={c.clave}>{c.es} / {c.en}</option>)}
                      </select>
                    </td>
                  )}
                  <td className="px-2 py-1.5 w-24">{campo(f, 'numeroPaleta', 'N.º de paleta')}</td>
                  <td className="px-2 py-1.5 w-32">
                    {campo(f, 'pesoBruto', 'Peso bruto', 'text-right')}
                    {error && f.pesoBruto.trim() !== '' && <p role="alert" className="mt-0.5 text-[11px] text-red-600">{error}</p>}
                  </td>
                  <td className="px-2 py-1.5 w-32">{campo(f, 'pesoPaleta', 'Peso de la paleta', 'text-right')}</td>
                  <td className="px-2 py-1.5 w-32 text-right tabular-nums font-medium">
                    {formatearPeso(calcularNeto(parsearPeso(f.pesoBruto), parsearPeso(f.pesoPaleta)))}
                  </td>
                  <td className="px-2 py-1.5">
                    {puedeEditar && (
                      <button type="button" onClick={() => onQuitar(f.clave)} aria-label={`Quitar fila ${i + 1}`} title="Quitar"
                        className="p-1.5 rounded-md text-text-muted hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {puedeEditar && (
        <button type="button" onClick={onAgregar}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
          <Plus size={16} aria-hidden="true" /> Agregar {nombreBulto.toLowerCase()}
        </button>
      )}
    </div>
  );
}

export default PackingListFilas;
