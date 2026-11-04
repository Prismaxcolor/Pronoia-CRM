import { useState } from 'react';
import Modal from '../../components/Modal';
import { X } from 'lucide-react';
import { cambiarCategoriaNota } from '../../services/nota-ajuste-service';
import { useCategorias } from '../cochinito/categorias/useCategorias';
import SelectorCategoriaTarjetas from '../cochinito/categorias/SelectorCategoriaTarjetas';
import { categoriaElegibleParaNota } from './nota-categoria-logica';

interface Props {
  esProveedor: boolean;
  entidadId: string;
  notaId: string;
  /** Categoría que tiene la nota ahora (null = sin categoría). */
  categoriaActualId: string | null;
  onClose: () => void;
  onGuardado: () => void;
}

/** Cambia solo la categoría de una nota ya creada. No toca montos ni saldos, por eso no pide llave de edición. */
function CambiarCategoriaNotaModal({ esProveedor, entidadId, notaId, categoriaActualId, onClose, onGuardado }: Props) {
  const { categorias, cargando, error: errorCategorias } = useCategorias();
  // Si la categoría actual se archivó ya no es elegible: se parte sin elección.
  const [elegida, setElegida] = useState<string | null>(categoriaActualId);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valor = categoriaElegibleParaNota(elegida, categorias);

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    const r = await cambiarCategoriaNota(esProveedor, entidadId, notaId, valor);
    setGuardando(false);
    if ('error' in r) { setError(r.error); return; }
    onGuardado();
  };

  return (
    <Modal onClose={onClose} bloqueado={guardando} ariaLabel="Cambiar categoría de la nota" ancho="max-w-md">
      <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-surface">
        <h2 className="text-lg font-bold text-text-primary">Categoría de la nota</h2>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded text-text-muted hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"><X size={20} /></button>
      </div>
      <div className="p-5 space-y-4">
        {cargando && <p className="text-sm text-text-muted">Cargando categorías…</p>}
        {!cargando && errorCategorias && <p role="alert" className="text-sm text-red-600">{errorCategorias}</p>}
        {!cargando && !errorCategorias && (
          <SelectorCategoriaTarjetas categorias={categorias} valor={valor} onChange={setElegida} permitirSinCategoria etiqueta="Categoría de la nota" />
        )}
        <p className="text-xs text-text-muted">Cambiar la categoría no modifica el monto ni el saldo de la cuenta.</p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover">Cancelar</button>
          <button type="button" onClick={guardar} disabled={guardando || cargando || Boolean(errorCategorias)} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default CambiarCategoriaNotaModal;
