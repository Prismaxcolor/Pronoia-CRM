import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, EyeOff, Eye, Trash2, Mail, Phone, FileText } from 'lucide-react';
import {
  obtenerProveedores,
  desactivarProveedor,
  reactivarProveedor,
  borrarProveedor,
} from '../../services/proveedor-service';
import { useAuth } from '../../hooks/use-auth';
import { useToast } from '../../hooks/use-toast';
import { useConfirm } from '../../hooks/use-confirm';
import ProveedorFormModal from './ProveedorFormModal';
import type { Proveedor } from '@shared/types/index.js';

function ProveedoresPage() {
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [formAbierto, setFormAbierto] = useState<{ abierto: true; proveedor: Proveedor | null } | { abierto: false }>({ abierto: false });
  const navigate = useNavigate();
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const confirmar = useConfirm();

  const puedeCrear = tienePermiso('proveedores', 'crear');
  const puedeEditar = tienePermiso('proveedores', 'editar');
  const puedeBorrar = tienePermiso('proveedores', 'eliminar');

  const cargar = () => {
    setCargando(true);
    obtenerProveedores().then(setProveedores).finally(() => setCargando(false));
  };

  useEffect(() => { cargar(); }, []);

  const handleDesactivar = async (p: Proveedor) => {
    const ok = await confirmar({
      titulo: `Desactivar a "${p.nombre}"`,
      mensaje: 'Dejará de aparecer en los selectores activos, pero su historial se conserva.',
      confirmarLabel: 'Desactivar',
      variante: 'warning',
    });
    if (!ok) return;
    const result = await desactivarProveedor(p.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${p.nombre}" desactivado.`);
    cargar();
  };

  const handleReactivar = async (p: Proveedor) => {
    const result = await reactivarProveedor(p.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${p.nombre}" reactivado.`);
    cargar();
  };

  const handleBorrar = async (p: Proveedor) => {
    const ok = await confirmar({
      titulo: `Borrar a "${p.nombre}" definitivamente`,
      mensaje: 'Esta acción es irreversible.',
      confirmarLabel: 'Borrar definitivamente',
      variante: 'danger',
    });
    if (!ok) return;
    const result = await borrarProveedor(p.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${p.nombre}" eliminado.`);
    cargar();
  };

  const filtrados = proveedores.filter(p => {
    if (!busqueda.trim()) return true;
    const q = busqueda.trim().toLowerCase();
    return (
      p.nombre.toLowerCase().includes(q) ||
      (p.rfc ?? '').toLowerCase().includes(q) ||
      (p.email ?? '').toLowerCase().includes(q) ||
      (p.telefono ?? '').toLowerCase().includes(q)
    );
  });

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
          <h1 className="text-2xl font-bold text-text-primary">Proveedores</h1>
          <p className="text-sm text-text-secondary mt-1">A quién le compras chatarra electrónica</p>
        </div>
        {puedeCrear && (
          <button
            type="button"
            onClick={() => setFormAbierto({ abierto: true, proveedor: null })}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            <Plus size={18} />
            Nuevo proveedor
          </button>
        )}
      </div>

      <div className="mb-4">
        <input
          type="search"
          placeholder="Buscar por nombre, RIF, email o teléfono..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          className="w-full max-w-md px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtrados.map(p => (
          <div
            key={p.id}
            className={`group relative bg-surface rounded-xl p-5 shadow-sm border border-border hover:shadow-md transition-shadow ${
              !p.activo ? 'opacity-60' : ''
            }`}
          >
            {(puedeEditar || puedeBorrar) && (
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {puedeEditar && (
                  <button
                    type="button"
                    onClick={() => setFormAbierto({ abierto: true, proveedor: p })}
                    className="p-1.5 rounded-md bg-surface-alt hover:bg-brand-50 text-text-muted hover:text-brand-600 transition-colors"
                    title="Editar"
                  >
                    <Pencil size={13} />
                  </button>
                )}
                {puedeEditar && p.activo && (
                  <button
                    type="button"
                    onClick={() => handleDesactivar(p)}
                    className="p-1.5 rounded-md bg-surface-alt hover:bg-amber-50 text-text-muted hover:text-amber-600 transition-colors"
                    title="Desactivar"
                  >
                    <EyeOff size={13} />
                  </button>
                )}
                {puedeEditar && !p.activo && (
                  <button
                    type="button"
                    onClick={() => handleReactivar(p)}
                    className="p-1.5 rounded-md bg-surface-alt hover:bg-green-50 text-text-muted hover:text-green-600 transition-colors"
                    title="Reactivar"
                  >
                    <Eye size={13} />
                  </button>
                )}
                {puedeBorrar && (
                  <button
                    type="button"
                    onClick={() => handleBorrar(p)}
                    className="p-1.5 rounded-md bg-surface-alt hover:bg-red-50 text-text-muted hover:text-red-600 transition-colors"
                    title="Borrar definitivamente"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            )}

            <div className="flex items-start gap-3 mb-3 pr-20">
              <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-sm shrink-0">
                {p.nombre.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-text-primary text-sm leading-tight truncate">{p.nombre}</h3>
                {p.rfc && (
                  <p className="text-xs text-text-muted mt-0.5">{p.rfc}</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5 text-xs text-text-secondary">
              {p.email && (
                <div className="flex items-center gap-1.5 truncate">
                  <Mail size={12} className="shrink-0 text-text-muted" />
                  <span className="truncate">{p.email}</span>
                </div>
              )}
              {p.telefono && (
                <div className="flex items-center gap-1.5">
                  <Phone size={12} className="shrink-0 text-text-muted" />
                  <span>{p.telefono}</span>
                </div>
              )}
            </div>

            {!p.activo && (
              <span className="mt-3 inline-block px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded-full">Inactivo</span>
            )}

            <button
              type="button"
              onClick={() => navigate(`/proveedores/${p.id}/estado-cuenta`)}
              className="mt-4 w-full flex items-center justify-center gap-1.5 py-2 border border-border rounded-lg text-xs font-medium text-text-secondary hover:bg-surface-alt hover:text-brand-600 transition-colors"
            >
              <FileText size={14} />
              Estado de cuenta
            </button>
          </div>
        ))}
      </div>

      {filtrados.length === 0 && (
        <p className="text-center text-text-muted py-12">
          {proveedores.length === 0 ? 'No hay proveedores registrados' : 'No se encontraron proveedores con esa búsqueda'}
        </p>
      )}

      {formAbierto.abierto && (
        <ProveedorFormModal
          proveedor={formAbierto.proveedor}
          onClose={() => setFormAbierto({ abierto: false })}
          onGuardado={() => { setFormAbierto({ abierto: false }); cargar(); }}
        />
      )}
    </div>
  );
}

export default ProveedoresPage;
