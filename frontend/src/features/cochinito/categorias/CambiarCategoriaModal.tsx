import { useState } from 'react';
import { X } from 'lucide-react';
import type { CategoriaWallet, Movimiento } from '@shared/types/index.js';
import { cambiarCategoriaMovimiento } from '../../../services/categoria-wallet-service';
import SelectorCategoria from './SelectorCategoria';
import EtiquetaCategoria from './EtiquetaCategoria';
import {
  ELECCION_VACIA, VALOR_SIN_CATEGORIA, categoriaIdDeEleccion, eleccionDeCategoriaId, etiquetaCategoria, mensajeEleccion, opcionesParaTipo,
} from './categorias-logica';

interface Props {
  movimiento: Movimiento;
  categorias: readonly CategoriaWallet[];
  indice: ReadonlyMap<string, CategoriaWallet>;
  onClose: () => void;
  onGuardado: () => void;
}

/** Cambia solo la categoría de un ingreso o egreso ya registrado. No toca montos ni saldos, por eso no pide llave de edición. */
function CambiarCategoriaModal({ movimiento, categorias, indice, onClose, onGuardado }: Props) {
  const tipo = movimiento.tipo === 'ingreso' ? 'ingreso' : 'egreso';
  const actual = etiquetaCategoria(movimiento.categoriaId, indice);
  const inicial = eleccionDeCategoriaId(movimiento.categoriaId, indice);
  // Si la categoría actual está archivada ya no es elegible: se parte sin elección para obligar a escoger.
  const elegible = inicial.categoria === VALOR_SIN_CATEGORIA || opcionesParaTipo(categorias, tipo).some(n => n.categoria.id === inicial.categoria);
  const [eleccion, setEleccion] = useState(elegible ? inicial : ELECCION_VACIA);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    const falta = mensajeEleccion(eleccion);
    if (falta) { setError(falta); return; }
    setGuardando(true);
    const r = await cambiarCategoriaMovimiento(movimiento.id, categoriaIdDeEleccion(eleccion));
    setGuardando(false);
    if ('error' in r) { setError(r.error); return; }
    onGuardado();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="Cambiar categoría">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-bold text-text-primary">Cambiar categoría</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded text-text-muted hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-text-secondary">{movimiento.descripcion || 'Movimiento sin concepto'}</p>
          <p className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
            Categoría actual: {actual ? <EtiquetaCategoria nombre={actual.nombre} color={actual.color} /> : 'Sin categoría'}
          </p>
          <SelectorCategoria tipo={tipo} categorias={categorias} valor={eleccion} onChange={e => { setEleccion(e); setError(null); }} error={error} />
          <p className="text-xs text-text-muted">Cambiar la categoría no modifica el monto ni el saldo de la cuenta.</p>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover">Cancelar</button>
            <button type="button" onClick={guardar} disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CambiarCategoriaModal;
