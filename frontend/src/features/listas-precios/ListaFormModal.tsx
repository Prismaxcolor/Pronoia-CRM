import { useState } from 'react';
import { X } from 'lucide-react';
import { crearLista, actualizarLista } from '../../services/lista-precios-service';
import { useToast } from '../../hooks/use-toast';
import type { ListaPrecios } from '@shared/types/index.js';

interface Props {
  /** Si se pasa, modo "editar". Si no, modo "crear". */
  lista?: ListaPrecios | null;
  onClose: () => void;
  onGuardado: () => void;
}

function ListaFormModal({ lista, onClose, onGuardado }: Props) {
  const toast = useToast();
  const editando = !!lista;

  const [nombre, setNombre] = useState(lista?.nombre ?? '');
  const [vigenteDesde, setVigenteDesde] = useState(lista?.vigenteDesde ?? '');
  const [activo, setActivo] = useState(lista?.activo ?? true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);

    const result = editando && lista
      ? await actualizarLista(lista.id, {
          nombre: nombre.trim(),
          vigenteDesde: vigenteDesde || null,
          activo,
        })
      : await crearLista({ nombre: nombre.trim(), vigenteDesde: vigenteDesde || null });

    setGuardando(false);

    if ('lista' in result) {
      toast.exito(editando ? `"${result.lista.nombre}" actualizada.` : `"${result.lista.nombre}" creada.`);
      onGuardado();
    } else {
      setError(result.error);
    }
  };

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-bold text-text-primary">
            {editando ? 'Editar lista' : 'Nueva lista de precios'}
          </h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className={labelClass}>Nombre *</label>
            <input
              type="text"
              required
              value={nombre}
              onChange={e => setNombre(e.target.value)}
              className={inputClass}
              placeholder="Ej. Precios Junio"
            />
          </div>

          <div>
            <label className={labelClass}>Vigente desde</label>
            <input
              type="date"
              value={vigenteDesde}
              onChange={e => setVigenteDesde(e.target.value)}
              className={inputClass}
            />
          </div>

          {editando && (
            <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={activo}
                onChange={e => setActivo(e.target.checked)}
                className="rounded border-border text-brand-600 focus:ring-brand-400"
              />
              Lista activa (aparece en los selectores de factura)
            </label>
          )}

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Crear lista'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ListaFormModal;
