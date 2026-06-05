import { useState } from 'react';
import { X, Check } from 'lucide-react';
import { actualizarUsuario } from '../../services/usuario-service';
import { useToast } from '../../hooks/use-toast';
import { PERMISOS_POR_ROL } from '@shared/types/index.js';
import type { Usuario, RolUsuario, Permiso, Recurso, Accion } from '@shared/types/index.js';

interface Props {
  usuario: Usuario;
  onClose: () => void;
  onGuardado: () => void;
}

const RECURSOS: { recurso: Recurso; label: string }[] = [
  { recurso: 'dashboard', label: 'Dashboard' },
  { recurso: 'productos', label: 'Productos' },
  { recurso: 'facturacion', label: 'Facturacion' },
  { recurso: 'cochinito', label: 'Cochinito (Tesoreria)' },
  { recurso: 'usuarios', label: 'Usuarios' },
];

const ACCIONES: Accion[] = ['ver', 'crear', 'editar', 'eliminar'];

function EditarPermisosModal({ usuario, onClose, onGuardado }: Props) {
  const [rol, setRol] = useState<RolUsuario>(usuario.rol);
  const [permisos, setPermisos] = useState<Permiso[]>(usuario.permisos);
  const [guardando, setGuardando] = useState(false);
  const [useCustom, setUseCustom] = useState(
    JSON.stringify(usuario.permisos) !== JSON.stringify(PERMISOS_POR_ROL[usuario.rol])
  );
  const toast = useToast();

  const tienePermiso = (recurso: Recurso, accion: Accion): boolean => {
    return permisos.some(p => p.recurso === recurso && p.accion === accion);
  };

  const togglePermiso = (recurso: Recurso, accion: Accion) => {
    if (tienePermiso(recurso, accion)) {
      setPermisos(permisos.filter(p => !(p.recurso === recurso && p.accion === accion)));
    } else {
      setPermisos([...permisos, { recurso, accion }]);
    }
  };

  const handleRolChange = (nuevoRol: RolUsuario) => {
    setRol(nuevoRol);
    if (!useCustom) {
      setPermisos(PERMISOS_POR_ROL[nuevoRol]);
    }
  };

  const handleCustomToggle = (custom: boolean) => {
    setUseCustom(custom);
    if (!custom) {
      setPermisos(PERMISOS_POR_ROL[rol]);
    }
  };

  const handleGuardar = async () => {
    setGuardando(true);
    const permisosGuardar = useCustom ? permisos : [];
    const result = await actualizarUsuario(usuario.id, { rol, permisos: permisosGuardar });
    setGuardando(false);
    if ('usuario' in result) {
      toast.exito(`Permisos de ${usuario.nombre} actualizados.`);
      onGuardado();
    } else {
      toast.errorMsg(result.error);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-lg font-bold text-text-primary">Editar permisos</h2>
            <p className="text-sm text-text-secondary">{usuario.nombre} — {usuario.email}</p>
          </div>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Selector de rol */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-2">Rol</label>
            <div className="grid grid-cols-3 gap-2">
              {(['trabajador', 'administracion', 'superadmin'] as RolUsuario[]).map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => handleRolChange(r)}
                  className={`px-3 py-2 rounded-lg border-2 text-xs font-medium capitalize transition-all ${
                    rol === r
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-border text-text-secondary hover:border-brand-200'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Toggle permisos custom */}
          <div className="flex items-center justify-between p-3 bg-surface-alt rounded-lg border border-border">
            <div>
              <p className="text-sm font-medium text-text-primary">Permisos personalizados</p>
              <p className="text-xs text-text-muted">Sobreescribe los permisos por defecto del rol</p>
            </div>
            <button
              type="button"
              onClick={() => handleCustomToggle(!useCustom)}
              className={`w-11 h-6 rounded-full transition-colors relative ${useCustom ? 'bg-brand-600' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${useCustom ? 'translate-x-5.5' : 'translate-x-0.5'}`} />
            </button>
          </div>

          {/* Matriz de permisos */}
          {useCustom && (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="overflow-x-auto"><table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface-alt border-b border-border">
                    <th className="text-left p-3 font-medium text-text-secondary">Seccion</th>
                    {ACCIONES.map(a => (
                      <th key={a} className="text-center p-3 font-medium text-text-secondary capitalize w-16">{a}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {RECURSOS.map(({ recurso, label }) => (
                    <tr key={recurso} className="border-b border-border last:border-0">
                      <td className="p-3 font-medium text-text-primary">{label}</td>
                      {ACCIONES.map(accion => (
                        <td key={accion} className="text-center p-3">
                          <button
                            type="button"
                            onClick={() => togglePermiso(recurso, accion)}
                            className={`w-7 h-7 rounded-md flex items-center justify-center transition-all ${
                              tienePermiso(recurso, accion)
                                ? 'bg-brand-600 text-white'
                                : 'bg-surface-alt border border-border text-transparent hover:border-brand-300'
                            }`}
                          >
                            <Check size={14} />
                          </button>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          )}

          {!useCustom && (
            <div className="p-3 bg-surface-alt rounded-lg border border-border">
              <p className="text-xs text-text-secondary mb-2">Permisos por defecto de <strong>{rol}</strong>:</p>
              <div className="flex flex-wrap gap-1.5">
                {PERMISOS_POR_ROL[rol].map((p, i) => (
                  <span key={i} className="px-2 py-0.5 bg-brand-100 text-brand-700 text-xs rounded-full">
                    {p.recurso}: {p.accion}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Botones */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="button" onClick={handleGuardar} disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default EditarPermisosModal;
