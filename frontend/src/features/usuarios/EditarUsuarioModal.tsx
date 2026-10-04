import { useState } from 'react';
import { X } from 'lucide-react';
import { actualizarUsuario, type ActualizarUsuarioCambios } from '../../services/usuario-service';
import { useToast } from '../../hooks/use-toast-context';
import { useAuth } from '../../hooks/use-auth-context';
import type { RolUsuario, Usuario } from '@shared/types/index.js';

interface Props {
  usuario: Usuario;
  onClose: () => void;
  onGuardado: () => void;
}

const MIN_PASSWORD = 8;

function EditarUsuarioModal({ usuario, onClose, onGuardado }: Props) {
  const { usuario: currentUser } = useAuth();
  const esYo = usuario.id === currentUser?.id;
  // El backend exige superadmin para cambiar correo, contraseña o asignar el rol superadmin.
  const esSuperadmin = currentUser?.rol === 'superadmin';
  const [nombre, setNombre] = useState(usuario.nombre);
  const [email, setEmail] = useState(usuario.email);
  const [rol, setRol] = useState<RolUsuario>(usuario.rol);
  const [activo, setActivo] = useState(usuario.activo);
  const [temaMarca, setTemaMarca] = useState<'azul' | null>(usuario.temaMarca ?? null);
  const [password, setPassword] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const nombreLimpio = nombre.trim();
    const emailLimpio = email.trim().toLowerCase();
    if (password && password.length < MIN_PASSWORD) {
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
      return;
    }

    const cambios: ActualizarUsuarioCambios = {};
    if (nombreLimpio !== usuario.nombre) cambios.nombre = nombreLimpio;
    if (emailLimpio !== usuario.email) cambios.email = emailLimpio;
    if (rol !== usuario.rol) cambios.rol = rol;
    if (activo !== usuario.activo) cambios.activo = activo;
    if (temaMarca !== (usuario.temaMarca ?? null)) cambios.temaMarca = temaMarca;
    if (password) cambios.password = password;

    if (Object.keys(cambios).length === 0) {
      setError('No hay cambios para guardar.');
      return;
    }

    setGuardando(true);
    const result = await actualizarUsuario(usuario.id, cambios);
    setGuardando(false);

    if ('usuario' in result) {
      toast.exito(`Usuario "${result.usuario.nombre}" actualizado.`);
      onGuardado();
    } else {
      setError(result.error);
    }
  };

  const inputClass = "w-full px-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent disabled:opacity-60";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-bold text-text-primary">Editar usuario</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Nombre completo</label>
            <input type="text" required minLength={2} maxLength={80} value={nombre} onChange={e => setNombre(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Correo electrónico</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} disabled={!esSuperadmin} className={inputClass} />
            {!esSuperadmin && <p className="text-xs text-text-muted mt-1">Solo un superadmin puede cambiar el correo.</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Rol</label>
            <select value={rol} onChange={e => setRol(e.target.value as RolUsuario)} disabled={esYo && usuario.rol === 'superadmin'} className={inputClass}>
              <option value="trabajador">Trabajador</option>
              <option value="administracion">Administración</option>
              <option value="superadmin" disabled={!esSuperadmin}>Superadmin — acceso total</option>
            </select>
            {esYo && usuario.rol === 'superadmin' && (
              <p className="text-xs text-text-muted mt-1">No puedes quitarte a ti mismo el rol de superadmin.</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Color del sistema</label>
            <select
              value={temaMarca ?? ''}
              onChange={e => setTemaMarca(e.target.value === 'azul' ? 'azul' : null)}
              disabled={!esSuperadmin}
              className={inputClass}
            >
              <option value="">Verde (por defecto)</option>
              <option value="azul">Azul</option>
            </select>
            {!esSuperadmin && <p className="text-xs text-text-muted mt-1">Solo un superadmin puede cambiar el color del sistema.</p>}
          </div>
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input type="checkbox" checked={activo} onChange={e => setActivo(e.target.checked)} disabled={esYo} />
            Usuario activo
            {esYo && <span className="text-xs text-text-muted">(no puedes desactivarte a ti mismo)</span>}
          </label>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Nueva contraseña (opcional)</label>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={!esSuperadmin}
              className={inputClass}
              placeholder="Dejar vacío para no cambiarla"
            />
            {!esSuperadmin && <p className="text-xs text-text-muted mt-1">Solo un superadmin puede restablecer contraseñas.</p>}
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default EditarUsuarioModal;
