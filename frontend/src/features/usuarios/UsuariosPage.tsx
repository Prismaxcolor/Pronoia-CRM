import { useEffect, useState } from 'react';
import { Plus, Shield, UserX, UserCheck, Trash2 } from 'lucide-react';
import {
  obtenerUsuarios,
  desactivarUsuario,
  reactivarUsuario,
  borrarUsuario,
} from '../../services/usuario-service';
import { useAuth } from '../../hooks/use-auth';
import { useToast } from '../../hooks/use-toast';
import { useConfirm } from '../../hooks/use-confirm';
import CrearUsuarioModal from './CrearUsuarioModal';
import EditarPermisosModal from './EditarPermisosModal';
import type { Usuario } from '@shared/types/index.js';

const ROL_BADGE: Record<string, { bg: string; text: string }> = {
  superadmin: { bg: 'bg-purple-100', text: 'text-purple-700' },
  administracion: { bg: 'bg-blue-100', text: 'text-blue-700' },
  trabajador: { bg: 'bg-gray-100', text: 'text-gray-700' },
};

function UsuariosPage() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [mostrarCrear, setMostrarCrear] = useState(false);
  const [editando, setEditando] = useState<Usuario | null>(null);
  const { usuario: currentUser } = useAuth();
  const toast = useToast();
  const confirmar = useConfirm();

  const cargar = () => {
    setCargando(true);
    obtenerUsuarios().then(setUsuarios).finally(() => setCargando(false));
  };

  useEffect(() => { cargar(); }, []);

  const handleDesactivar = async (u: Usuario) => {
    if (u.id === currentUser?.id) return;
    const ok = await confirmar({
      titulo: `Desactivar a ${u.nombre}`,
      mensaje: 'El usuario no podrá iniciar sesión, pero su historial financiero se conserva. Podrás reactivarlo más adelante.',
      confirmarLabel: 'Desactivar',
      variante: 'warning',
    });
    if (!ok) return;
    const result = await desactivarUsuario(u.id);
    if ('error' in result) {
      toast.errorMsg(result.error);
      return;
    }
    toast.exito(`${u.nombre} desactivado.`);
    cargar();
  };

  const handleReactivar = async (u: Usuario) => {
    const result = await reactivarUsuario(u.id);
    if ('error' in result) {
      toast.errorMsg(result.error);
      return;
    }
    toast.exito(`${u.nombre} reactivado.`);
    cargar();
  };

  const handleBorrar = async (u: Usuario) => {
    if (u.id === currentUser?.id) return;
    const ok = await confirmar({
      titulo: `Borrar a ${u.nombre} definitivamente`,
      mensaje: `Esta acción es irreversible. Solo se permite si el usuario NO tiene movimientos ni facturas asociados.\n\nSi tiene historial financiero, mantenlo desactivado en su lugar.`,
      confirmarLabel: 'Borrar definitivamente',
      variante: 'danger',
    });
    if (!ok) return;
    const result = await borrarUsuario(u.id);
    if ('error' in result) {
      toast.errorMsg(result.error);
      return;
    }
    toast.exito(`${u.nombre} eliminado de la base de datos.`);
    cargar();
  };

  if (cargando) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Usuarios</h1>
          <p className="text-sm text-text-secondary mt-1">Gestiona roles y permisos del equipo</p>
        </div>
        <button
          type="button"
          onClick={() => setMostrarCrear(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg
                     text-sm font-medium hover:bg-brand-700 transition-colors"
        >
          <Plus size={18} />
          Nuevo usuario
        </button>
      </div>

      {/* Tabla de usuarios */}
      <div className="bg-surface rounded-xl shadow-sm border border-border overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-alt">
              <th className="text-left p-4 font-medium text-text-secondary">Usuario</th>
              <th className="text-left p-4 font-medium text-text-secondary">Rol</th>
              <th className="text-left p-4 font-medium text-text-secondary">Permisos</th>
              <th className="text-left p-4 font-medium text-text-secondary">Estado</th>
              <th className="text-right p-4 font-medium text-text-secondary">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map(u => {
              const badge = ROL_BADGE[u.rol] ?? ROL_BADGE.trabajador;
              const esYo = u.id === currentUser?.id;
              return (
                <tr
                  key={u.id}
                  className={`border-b border-border last:border-0 hover:bg-surface-hover transition-colors ${
                    !u.activo ? 'opacity-60' : ''
                  }`}
                >
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-sm">
                        {u.nombre.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-text-primary">
                          {u.nombre} {esYo && <span className="text-xs text-text-muted">(tú)</span>}
                        </p>
                        <p className="text-xs text-text-muted">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
                      {u.rol}
                    </span>
                  </td>
                  <td className="p-4">
                    <span className="text-xs text-text-secondary">
                      {u.permisos.length} permiso{u.permisos.length !== 1 ? 's' : ''}
                    </span>
                  </td>
                  <td className="p-4">
                    <span className={`inline-flex items-center gap-1 text-xs font-medium ${u.activo ? 'text-green-600' : 'text-red-500'}`}>
                      <span className={`w-2 h-2 rounded-full ${u.activo ? 'bg-green-500' : 'bg-red-400'}`} />
                      {u.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setEditando(u)}
                        className="p-2 text-text-muted hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                        title="Editar permisos"
                      >
                        <Shield size={16} />
                      </button>
                      {!esYo && u.activo && (
                        <button
                          type="button"
                          onClick={() => handleDesactivar(u)}
                          className="p-2 text-text-muted hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                          title="Desactivar"
                        >
                          <UserX size={16} />
                        </button>
                      )}
                      {!esYo && !u.activo && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleReactivar(u)}
                            className="p-2 text-text-muted hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                            title="Reactivar"
                          >
                            <UserCheck size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleBorrar(u)}
                            className="p-2 text-text-muted hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Borrar definitivamente"
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        {usuarios.length === 0 && (
          <p className="p-8 text-center text-text-muted">No hay usuarios registrados</p>
        )}
      </div>

      {mostrarCrear && (
        <CrearUsuarioModal
          onClose={() => setMostrarCrear(false)}
          onCreado={() => { setMostrarCrear(false); cargar(); }}
        />
      )}

      {editando && (
        <EditarPermisosModal
          usuario={editando}
          onClose={() => setEditando(null)}
          onGuardado={() => { setEditando(null); cargar(); }}
        />
      )}
    </div>
  );
}

export default UsuariosPage;
