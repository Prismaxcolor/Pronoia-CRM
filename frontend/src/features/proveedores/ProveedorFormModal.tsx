import { useState } from 'react';
import { X } from 'lucide-react';
import { crearProveedor, actualizarProveedor } from '../../services/proveedor-service';
import { useToast } from '../../hooks/use-toast';
import type { Proveedor } from '@shared/types/index.js';

interface Props {
  /** Si se pasa, modo "editar". Si no, modo "crear". */
  proveedor?: Proveedor | null;
  onClose: () => void;
  onGuardado: () => void;
}

function ProveedorFormModal({ proveedor, onClose, onGuardado }: Props) {
  const toast = useToast();
  const editando = !!proveedor;

  const [nombre, setNombre] = useState(proveedor?.nombre ?? '');
  const [rfc, setRfc] = useState(proveedor?.rfc ?? '');
  const [telefono, setTelefono] = useState(proveedor?.telefono ?? '');
  const [email, setEmail] = useState(proveedor?.email ?? '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);

    const payload = {
      nombre: nombre.trim(),
      rfc: rfc.trim() || null,
      telefono: telefono.trim() || null,
      email: email.trim() || null,
    };

    const result = editando && proveedor
      ? await actualizarProveedor(proveedor.id, payload)
      : await crearProveedor(payload);

    setGuardando(false);

    if ('proveedor' in result) {
      toast.exito(editando ? `"${result.proveedor.nombre}" actualizado.` : `"${result.proveedor.nombre}" creado.`);
      onGuardado();
    } else {
      setError(result.error);
    }
  };

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-bold text-text-primary">
            {editando ? 'Editar proveedor' : 'Nuevo proveedor'}
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
              placeholder="Ej. Reciclados El Valle C.A."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>RIF / Cédula</label>
              <input
                type="text"
                value={rfc}
                onChange={e => setRfc(e.target.value)}
                className={inputClass}
                placeholder="J-12345678-9"
              />
            </div>
            <div>
              <label className={labelClass}>Teléfono</label>
              <input
                type="text"
                value={telefono}
                onChange={e => setTelefono(e.target.value)}
                className={inputClass}
                placeholder="+58 412 1234567"
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className={inputClass}
              placeholder="proveedor@ejemplo.com"
            />
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Crear proveedor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ProveedorFormModal;
