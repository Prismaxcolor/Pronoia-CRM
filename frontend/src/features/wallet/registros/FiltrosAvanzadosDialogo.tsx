import { useMemo } from 'react';
import { X } from 'lucide-react';
import Modal from '../../../components/Modal';
import AvisoSinCategorias from '../../cochinito/categorias/AvisoSinCategorias';
import { VALOR_SIN_CATEGORIA, armarArbol, filtrosCategoriaDeshabilitados } from '../../cochinito/categorias/categorias-logica';
import type { CategoriaWallet } from '@shared/types/index.js';

export interface ValoresAvanzados {
  tipo?: string;
  subtipo?: string;
  categoria?: string;
  subcategoria?: string;
  incluirAnulados: boolean;
}

interface Props {
  valores: ValoresAvanzados;
  categorias: readonly CategoriaWallet[];
  onCambiar: (cambios: { tipo?: string | undefined; subtipo?: string | undefined; categoria?: string | undefined; subcategoria?: string | undefined; sinanulados?: boolean }) => void;
  onLimpiar: () => void;
  onCerrar: () => void;
}

const CLASE_SELECT = 'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50';

interface CampoSelectProps {
  etiqueta: string;
  valor: string | undefined;
  opciones: ReadonlyArray<{ valor: string; etiqueta: string }>;
  textoTodas: string;
  deshabilitado?: boolean;
  onCambiar: (valor: string | undefined) => void;
}

function CampoSelect({ etiqueta, valor, opciones, textoTodas, deshabilitado, onCambiar }: CampoSelectProps) {
  return (
    <label className="block text-sm font-medium text-text-primary">
      {etiqueta}
      <select value={valor ?? ''} disabled={deshabilitado} onChange={e => onCambiar(e.target.value || undefined)} className={`mt-1 ${CLASE_SELECT}`}>
        <option value="">{textoTodas}</option>
        {opciones.map(o => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
      </select>
    </label>
  );
}

const OPCIONES_TIPO = [
  { valor: 'ingreso', etiqueta: 'Ingresos' },
  { valor: 'egreso', etiqueta: 'Egresos' },
  { valor: 'transferencia', etiqueta: 'Transferencias' },
];
const OPCIONES_SUBTIPO = [
  { valor: 'pago', etiqueta: 'Pagos' },
  { valor: 'adelanto', etiqueta: 'Adelantos' },
];

/** Diálogo "Filtros" de Registros: los mismos filtros avanzados de la Wallet clásica (FiltrosBarra), aplicados al instante. */
function FiltrosAvanzadosDialogo({ valores, categorias, onCambiar, onLimpiar, onCerrar }: Props) {
  const arbol = useMemo(() => armarArbol(categorias, true), [categorias]);
  const sinCategorias = filtrosCategoriaDeshabilitados(categorias);
  const opcionesCategoria = [{ valor: VALOR_SIN_CATEGORIA, etiqueta: 'Sin categoría' }, ...arbol.map(n => ({ valor: n.categoria.id, etiqueta: n.categoria.nombre }))];
  const hijas = arbol.find(n => n.categoria.id === valores.categoria)?.hijas ?? [];

  return (
    <Modal onClose={onCerrar} cerrarAlClicFondo ariaLabel="Filtros de registros" panelClassName="bg-surface rounded-2xl shadow-xl w-full max-w-md">
      <div className="flex items-center justify-between border-b border-border p-5">
        <h2 className="text-lg font-bold text-text-primary">Filtros</h2>
        <button type="button" onClick={onCerrar} aria-label="Cerrar" className="rounded text-text-muted hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"><X size={20} /></button>
      </div>
      <div className="space-y-4 p-5">
        <CampoSelect etiqueta="Tipo de movimiento" valor={valores.tipo} opciones={OPCIONES_TIPO} textoTodas="Todos" onCambiar={tipo => onCambiar({ tipo })} />
        <CampoSelect
          etiqueta="Categoría" valor={valores.categoria} opciones={opcionesCategoria} deshabilitado={sinCategorias}
          textoTodas={sinCategorias ? 'Sin categorías' : 'Todas'} onCambiar={categoria => onCambiar({ categoria, subcategoria: undefined })}
        />
        <CampoSelect
          etiqueta="Subcategoría" valor={valores.subcategoria} opciones={hijas.map(h => ({ valor: h.id, etiqueta: h.nombre }))}
          deshabilitado={sinCategorias || hijas.length === 0} textoTodas="Todas" onCambiar={subcategoria => onCambiar({ subcategoria })}
        />
        {sinCategorias && <AvisoSinCategorias />}
        <CampoSelect etiqueta="Pago o adelanto" valor={valores.subtipo} opciones={OPCIONES_SUBTIPO} textoTodas="Todos" onCambiar={subtipo => onCambiar({ subtipo })} />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={valores.incluirAnulados} onChange={e => onCambiar({ sinanulados: !e.target.checked })} className="h-4 w-4 accent-brand-600" />
          Incluir anulados (se muestran tachados y no suman)
        </label>
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onLimpiar} className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">Limpiar filtros</button>
          <button type="button" onClick={onCerrar} className="flex-1 rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">Listo</button>
        </div>
      </div>
    </Modal>
  );
}

export default FiltrosAvanzadosDialogo;
