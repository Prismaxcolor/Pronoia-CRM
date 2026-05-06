import { useState } from 'react';
import { X } from 'lucide-react';
import { crearUsuario } from '../../services/usuario-service';
import { useToast } from '../../hooks/use-toast';
import type { RolUsuario } from '@shared/types/index.js';

interface Props {
  onClose: () => void;
  onCreado: () => void;
}

function CrearUsuarioModal({ onClose, onCreado }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [rol, setRol] = useState<RolUsuario>('trabajador');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);

    const result = await crearUsuario(email, password, nombre, rol);
    setGuardando(false);

    if ('usuario' in result) {
      toast.exito(`Usuario "${result.usuario.nombre}" creado.`);
      onCreado();
    } else {
      setError(result.error);
    }
  };

  const inputClass = "w-full px-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-bold text-text-primary">Crear usuario</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Nombre completo</label>
            <input type="text" required value={nombre} onChange={e => setNombre(e.target.value)} className={inputClass} placeholder="Juan Perez" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Correo electronico</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className={inputClass} placeholder="juan@pronoia.com" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Contrasena</label>
            <input type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} className={inputClass} placeholder="Minimo 8 caracteres" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Rol</label>
            <select value={rol} onChange={e => setRol(e.target.value as RolUsuario)} className={inputClass}>
              <option value="trabajador">Trabajador — solo productos</option>
              <option value="administracion">Administracion — finanzas y productos</option>
              <option value="superadmin">Superadmin — acceso total</option>
            </select>
          </div>

          <div className="bg-surface-alt rounded-lg p-3 border border-border">
            <p className="text-xs text-text-secondary">
              <strong>Permisos por defecto del rol:</strong>
            </p>
            <ul className="mt-1 text-xs text-text-muted space-y-0.5">
              {rol === 'superadmin' && <li>Acceso total a todas las secciones</li>}
              {rol === 'administracion' && (
                <>
                  <li>Dashboard (ver)</li>
                  <li>Productos (ver)</li>
                  <li>Cochinito (ver, crear, editar)</li>
                </>
              )}
              {rol === 'trabajador' && (
                <>
                  <li>Productos (ver, crear, editar)</li>
                </>
              )}
            </ul>
            <p className="text-xs text-text-muted mt-2 italic">Puedes personalizar permisos después de crear el usuario.</p>
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? 'Creando...' : 'Crear usuario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CrearUsuarioModal;
