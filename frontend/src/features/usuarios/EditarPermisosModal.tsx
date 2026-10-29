import { useState } from 'react';
import Modal from '../../components/Modal';
import { X, Check } from 'lucide-react';
import { actualizarUsuario, guardarBancasDeUsuario } from '../../services/usuario-service';
import AccesoBancas from './AccesoBancas';
import { ROLES_CON_TODAS_LAS_BANCAS, type AccesoBancasUsuario } from './acceso-bancas';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import Switch from '../../components/Switch';
import { PERMISOS_POR_ROL } from '@shared/types/index.js';
import type { Usuario, RolUsuario, Permiso, Recurso, Accion } from '@shared/types/index.js';

/** Compara dos listas de permisos por contenido (recurso+acción), sin
 *  importar el orden — a diferencia de JSON.stringify, no da falsos
 *  "personalizado" cuando la lista de PERMISOS_POR_ROL cambia de orden o de
 *  tamaño (ej. se agregan recursos nuevos) pero el contenido efectivo del
 *  usuario sigue siendo el del rol. */
function mismosPermisos(a: Permiso[], b: Permiso[]): boolean {
  const claves = (arr: Permiso[]) => new Set(arr.map(p => `${p.recurso}:${p.accion}`));
  const setA = claves(a);
  const setB = claves(b);
  if (setA.size !== setB.size) return false;
  for (const k of setA) if (!setB.has(k)) return false;
  return true;
}

interface Props {
  usuario: Usuario;
  onClose: () => void;
  onGuardado: () => void;
}

/** `acciones`: si se indica, solo esas columnas aplican al recurso (el resto se muestra vacío). */
const RECURSOS: { recurso: Recurso; label: string; acciones?: Accion[] }[] = [
  { recurso: 'dashboard', label: 'Dashboard' },
  { recurso: 'productos', label: 'Productos' },
  { recurso: 'categorias', label: 'Categorías' },
  { recurso: 'taras', label: 'Taras' },
  { recurso: 'vehiculos', label: 'Vehículos' },
  { recurso: 'almacenes', label: 'Almacenes' },
  { recurso: 'listas_precios', label: 'Listas de precios' },
  { recurso: 'pesaje', label: 'Pesaje' },
  { recurso: 'traslados', label: 'Traslados' },
  { recurso: 'transformaciones', label: 'Transformaciones' },
  { recurso: 'toma_fisica', label: 'Toma física' },
  { recurso: 'facturacion', label: 'Facturacion' },
  { recurso: 'cochinito', label: 'Wallet (Tesoreria)' },
  { recurso: 'mesa_cambio', label: 'Mesa de cambio (Tesoreria)' },
  { recurso: 'nomina', label: 'Nómina (datos personales del personal)' },
  { recurso: 'clientes', label: 'Clientes' },
  { recurso: 'proveedores', label: 'Proveedores' },
  { recurso: 'despachos', label: 'Despachos' },
  { recurso: 'packing_list', label: 'Packing list (solo edición)', acciones: ['editar'] },
  { recurso: 'usuarios', label: 'Usuarios' },
];

const ACCIONES: Accion[] = ['ver', 'crear', 'editar', 'eliminar'];

function EditarPermisosModal({ usuario, onClose, onGuardado }: Props) {
  const { usuario: currentUser } = useAuth();
  // Solo el superadmin ve y asigna el acceso a cuentas/cajas (el backend lo exige).
  const esSuperadmin = currentUser?.rol === 'superadmin';
  const [rol, setRol] = useState<RolUsuario>(usuario.rol);
  const [permisos, setPermisos] = useState<Permiso[]>(usuario.permisos);
  const [guardando, setGuardando] = useState(false);
  const [useCustom, setUseCustom] = useState(
    !mismosPermisos(usuario.permisos, PERMISOS_POR_ROL[usuario.rol])
  );
  // Cuentas/cajas con acceso: null = aún no cargadas (no se guarda); solo se envía si la persona las tocó.
  const [accesoBancas, setAccesoBancas] = useState<{ acceso: AccesoBancasUsuario | null; modificado: boolean }>({ acceso: null, modificado: false });
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
    // El superadmin tiene acceso total siempre (el backend lo bypassea) —
    // permisos personalizados no tiene sentido acá y es justo lo que dejaba
    // arrays viejos pegados que confundían el conteo en la tabla de Usuarios.
    if (nuevoRol === 'superadmin') {
      setUseCustom(false);
      setPermisos(PERMISOS_POR_ROL.superadmin);
      return;
    }
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
    // rol === 'superadmin' manda siempre, incluso si useCustom quedó en true
    // por un array de permisos personalizados viejo con el que se abrió el
    // modal (el caso que dejaba superadmins con un conteo de permisos
    // corrupto) — así este guardado lo limpia en vez de reescribirlo.
    const permisosGuardar = rol === 'superadmin' ? [] : (useCustom ? permisos : []);
    const result = await actualizarUsuario(usuario.id, { rol, permisos: permisosGuardar });
    if ('usuario' in result && accesoBancas.modificado && accesoBancas.acceso !== null && !ROLES_CON_TODAS_LAS_BANCAS.includes(rol)) {
      const { ver, editar } = accesoBancas.acceso;
      const bancasGuardadas = await guardarBancasDeUsuario(usuario.id, [...ver], [...editar]);
      if ('error' in bancasGuardadas) toast.errorMsg(`Los permisos se guardaron, pero no el acceso a cuentas: ${bancasGuardadas.error}`);
    }
    setGuardando(false);
    if ('usuario' in result) {
      toast.exito(`Permisos de ${usuario.nombre} actualizados.`);
      onGuardado();
    } else {
      toast.errorMsg(result.error);
    }
  };

  return (
    <Modal onClose={onClose} bloqueado={guardando}>
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

        {/* Toggle permisos custom — no aplica a superadmin, que siempre tiene acceso total */}
        {rol === 'superadmin' ? (
          <div className="p-3 bg-brand-50 rounded-lg border border-brand-200">
            <p className="text-sm font-medium text-brand-700">Acceso total</p>
            <p className="text-xs text-brand-600">El superadministrador siempre puede ver y hacer todo — no admite permisos personalizados.</p>
          </div>
        ) : (
          <div className="flex items-center justify-between p-3 bg-surface-alt rounded-lg border border-border">
            <div>
              <p className="text-sm font-medium text-text-primary">Permisos personalizados</p>
              <p className="text-xs text-text-muted">Sobreescribe los permisos por defecto del rol</p>
            </div>
            <Switch checked={useCustom} onChange={handleCustomToggle} />
          </div>
        )}

        {/* Matriz de permisos */}
        {useCustom && rol !== 'superadmin' && (
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
                {RECURSOS.map(({ recurso, label, acciones }) => (
                  <tr key={recurso} className="border-b border-border last:border-0">
                    <td className="p-3 font-medium text-text-primary">{label}</td>
                    {ACCIONES.map(accion => acciones && !acciones.includes(accion) ? (
                      <td key={accion} className="p-3" />
                    ) : (
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

        {esSuperadmin && (
          <AccesoBancas
            usuarioId={usuario.id}
            rol={rol}
            onCambio={(acceso, modificado) => setAccesoBancas({ acceso, modificado })}
          />
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
    </Modal>
  );
}

export default EditarPermisosModal;
