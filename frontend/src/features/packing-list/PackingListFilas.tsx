import { Fragment, useState } from 'react';
import { Camera, Plus, Trash2 } from 'lucide-react';
import type { FotoPaletaPacking, OpcionLotePacking } from '@shared/types/index.js';
import { COLORES_LOTE, calcularNeto, errorFila, formatearPeso, parsearPeso } from '../../lib/packing-list';
import PackingListLoteSelect, { type EleccionLote } from './PackingListLoteSelect';
import PackingListFotosPaleta from './PackingListFotosPaleta';

/** Fila en edición: todo es texto mientras se escribe; se interpreta con parsearPeso al guardar. */
export interface FilaForm {
  clave: string;
  numeroPaleta: string;
  lote: string;
  color: string;
  /** Almacén del lote ('' = ninguno). Control interno: no sale en los PDF. */
  almacenId: string;
  /** Fotos de control interno de la paleta: no salen en los PDF. */
  fotos: FotoPaletaPacking[];
  pesoBruto: string;
  pesoPaleta: string;
}

/** Campos de la fila que se escriben como texto. */
export type CampoTextoFila = 'numeroPaleta' | 'lote' | 'color' | 'pesoBruto' | 'pesoPaleta';

interface Props {
  filas: FilaForm[];
  esPcb: boolean;
  nombreBulto: string;
  puedeEditar: boolean;
  /** Lotes de exportación con kg disponibles; null = no se pudieron cargar (el lote se escribe a mano). */
  opcionesLote: readonly OpcionLotePacking[] | null;
  /** Productos:ver o facturacion:ver. Sin él no hay columna de fotos ni se menciona el disponible/almacén. */
  puedeVerControl: boolean;
  onCambiar: (clave: string, campo: CampoTextoFila, valor: string) => void;
  onElegirLote: (clave: string, eleccion: EleccionLote) => void;
  onAgregarFoto: (clave: string, foto: FotoPaletaPacking) => void;
  onQuitarFoto: (clave: string, ruta: string) => void;
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

function PackingListFilas({
  filas, esPcb, nombreBulto, puedeEditar, opcionesLote, puedeVerControl, onCambiar, onElegirLote, onAgregarFoto, onQuitarFoto, onQuitar, onAgregar,
}: Props) {
  const [conFotosAbiertas, setConFotosAbiertas] = useState<string | null>(null);
  const columnas = (esPcb ? 9 : 7) - (puedeVerControl ? 0 : 1);
  const campo = (f: FilaForm, k: CampoTextoFila, etiqueta: string, extra = '') => (
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
      <p className="mb-1 text-xs text-text-muted md:hidden" aria-hidden="true">Desliza la tabla → para ver todas las columnas</p>
      <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-lg border-r-4 border-r-brand-200 md:border-r-0">
        <table className="w-full min-w-[46rem] text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>{nombreBulto}</th>
              {esPcb && <th className={TH}>{puedeVerControl ? 'Lote (disponible y almacén: solo control interno)' : 'Lote'}</th>}
              {esPcb && <th className={TH}>Color</th>}
              <th className={TH}>N.º de paleta</th>
              <th className={`${TH} text-right`}>Peso bruto (kg)</th>
              <th className={`${TH} text-right`}>Peso de la paleta (kg)</th>
              <th className={`${TH} text-right`}>Peso neto (kg)</th>
              {puedeVerControl && <th className={TH}>Fotos (interno)</th>}
              <th className={TH}><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => {
              const error = mensajeFila(f);
              return (
                <Fragment key={f.clave}>
                <tr className="border-b border-border/60 align-top">
                  <td className="px-2 py-1.5 tabular-nums text-text-secondary">{i + 1}</td>
                  {esPcb && (
                    <td className={`px-2 py-1.5 ${opcionesLote ? 'w-72' : 'w-24'}`}>
                      {opcionesLote
                        ? <PackingListLoteSelect lote={f.lote} almacenId={f.almacenId} opciones={opcionesLote} disabled={!puedeEditar}
                          etiqueta={`Lote (fila ${i + 1})`} className={INPUT} onElegir={e => onElegirLote(f.clave, e)} />
                        : campo(f, 'lote', 'Lote')}
                    </td>
                  )}
                  {esPcb && (
                    <td className="px-2 py-1.5 w-32 min-w-[6.5rem]">
                      <select
                        aria-label={`Color (fila ${i + 1})`}
                        value={f.color}
                        disabled={!puedeEditar}
                        onChange={e => onCambiar(f.clave, 'color', e.target.value)}
                        className={`${INPUT} min-w-[5.5rem]`}
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
                  {puedeVerControl && <td className="px-2 py-1.5">
                    <button type="button" aria-expanded={conFotosAbiertas === f.clave}
                      aria-label={`Fotos de la fila ${i + 1} (${f.fotos.length})`}
                      onClick={() => setConFotosAbiertas(a => (a === f.clave ? null : f.clave))}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-secondary hover:border-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                      <Camera size={14} aria-hidden="true" /> {f.fotos.length}
                    </button>
                  </td>}
                  <td className="px-2 py-1.5">
                    {puedeEditar && (
                      <button type="button" onClick={() => onQuitar(f.clave)} aria-label={`Quitar fila ${i + 1}`} title="Quitar"
                        className="p-1.5 rounded-md text-text-muted hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
                {puedeVerControl && conFotosAbiertas === f.clave && (
                  <tr className="border-b border-border/60 bg-surface-alt/40">
                    <td colSpan={columnas} className="px-3 py-2">
                      <PackingListFotosPaleta fotos={f.fotos} puedeEditar={puedeEditar}
                        onAgregar={foto => onAgregarFoto(f.clave, foto)} onQuitar={ruta => onQuitarFoto(f.clave, ruta)} />
                    </td>
                  </tr>
                )}
                </Fragment>
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
