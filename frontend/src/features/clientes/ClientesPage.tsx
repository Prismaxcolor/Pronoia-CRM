import { useEffect, useState } from 'react';
import { Plus, Pencil, EyeOff, Eye, Trash2, Mail, Phone, MapPin } from 'lucide-react';
import {
  obtenerClientes,
  desactivarCliente,
  reactivarCliente,
  borrarCliente,
} from '../../services/cliente-service';
import { useAuth } from '../../hooks/use-auth';
import { useToast } from '../../hooks/use-toast';
import { useConfirm } from '../../hooks/use-confirm';
import ClienteFormModal from './ClienteFormModal';
import type { Cliente } from '@shared/types/index.js';

function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [formAbierto, setFormAbierto] = useState<{ abierto: true; cliente: Cliente | null } | { abierto: false }>({ abierto: false });
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const confirmar = useConfirm();

  const puedeCrear = tienePermiso('clientes', 'crear');
  const puedeEditar = tienePermiso('clientes', 'editar');
  const puedeBorrar = tienePermiso('clientes', 'eliminar');

  const cargar = () => {
    setCargando(true);
    obtenerClientes().then(setClientes).finally(() => setCargando(false));
  };

  useEffect(() => { cargar(); }, []);

  const handleDesactivar = async (c: Cliente) => {
    const ok = await confirmar({
      titulo: `Desactivar a "${c.nombre}"`,
      mensaje: 'Dejará de aparecer en los selectores activos, pero su historial se conserva.',
      confirmarLabel: 'Desactivar',
      variante: 'warning',
    });
    if (!ok) return;
    const result = await desactivarCliente(c.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${c.nombre}" desactivado.`);
    cargar();
  };

  const handleReactivar = async (c: Cliente) => {
    const result = await reactivarCliente(c.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${c.nombre}" reactivado.`);
    cargar();
  };

  const handleBorrar = async (c: Cliente) => {
    const ok = await confirmar({
      titulo: `Borrar a "${c.nombre}" definitivamente`,
      mensaje: 'Esta acción es irreversible.',
      confirmarLabel: 'Borrar definitivamente',
      variante: 'danger',
    });
    if (!ok) return;
    const result = await borrarCliente(c.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${c.nombre}" eliminado.`);
    cargar();
  };

  const filtrados = clientes.filter(c => {
    if (!busqueda.trim()) return true;
    const q = busqueda.trim().toLowerCase();
    return (
      c.nombre.toLowerCase().includes(q) ||
      (c.identificacion ?? '').toLowerCase().includes(q) ||
      (c.email ?? '').toLowerCase().includes(q) ||
      (c.telefono ?? '').toLowerCase().includes(q)
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
          <h1 className="text-2xl font-bold text-text-primary">Clientes</h1>
          <p className="text-sm text-text-secondary mt-1">Clientes frecuentes para facturación</p>
        </div>
        {puedeCrear && (
          <button
            type="button"
            onClick={() => setFormAbierto({ abierto: true, cliente: null })}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            <Plus size={18} />
            Nuevo cliente
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
        {filtrados.map(c => (
          <div
            key={c.id}
            className={`group relative bg-surface rounded-xl p-5 shadow-sm border border-border hover:shadow-md transition-shadow ${
              !c.activo ? 'opacity-60' : ''
            }`}
          >
            {(puedeEditar || puedeBorrar) && (
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {puedeEditar && (
                  <button
                    type="button"
                    onClick={() => setFormAbierto({ abierto: true, cliente: c })}
                    className="p-1.5 rounded-md bg-surface-alt hover:bg-brand-50 text-text-muted hover:text-brand-600 transition-colors"
                    title="Editar"
                  >
                    <Pencil size={13} />
                  </button>
                )}
                {puedeEditar && c.activo && (
                  <button
                    type="button"
                    onClick={() => handleDesactivar(c)}
                    className="p-1.5 rounded-md bg-surface-alt hover:bg-amber-50 text-text-muted hover:text-amber-600 transition-colors"
                    title="Desactivar"
                  >
                    <EyeOff size={13} />
                  </button>
                )}
                {puedeEditar && !c.activo && (
                  <button
                    type="button"
                    onClick={() => handleReactivar(c)}
                    className="p-1.5 rounded-md bg-surface-alt hover:bg-green-50 text-text-muted hover:text-green-600 transition-colors"
                    title="Reactivar"
                  >
                    <Eye size={13} />
                  </button>
                )}
                {puedeBorrar && (
                  <button
                    type="button"
                    onClick={() => handleBorrar(c)}
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
                {c.nombre.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-text-primary text-sm leading-tight truncate">{c.nombre}</h3>
                {c.identificacion && (
                  <p className="text-xs text-text-muted mt-0.5">{c.identificacion}</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5 text-xs text-text-secondary">
              {c.email && (
                <div className="flex items-center gap-1.5 truncate">
                  <Mail size={12} className="shrink-0 text-text-muted" />
                  <span className="truncate">{c.email}</span>
                </div>
              )}
              {c.telefono && (
                <div className="flex items-center gap-1.5">
                  <Phone size={12} className="shrink-0 text-text-muted" />
                  <span>{c.telefono}</span>
                </div>
              )}
              {c.direccion && (
                <div className="flex items-start gap-1.5">
                  <MapPin size={12} className="shrink-0 text-text-muted mt-0.5" />
                  <span className="line-clamp-2">{c.direccion}</span>
                </div>
              )}
            </div>

            {!c.activo && (
              <span className="mt-3 inline-block px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded-full">Inactivo</span>
            )}
          </div>
        ))}
      </div>

      {filtrados.length === 0 && (
        <p className="text-center text-text-muted py-12">
          {clientes.length === 0 ? 'No hay clientes registrados' : 'No se encontraron clientes con esa búsqueda'}
        </p>
      )}

      {formAbierto.abierto && (
        <ClienteFormModal
          cliente={formAbierto.cliente}
          onClose={() => setFormAbierto({ abierto: false })}
          onGuardado={() => { setFormAbierto({ abierto: false }); cargar(); }}
        />
      )}
    </div>
  );
}

export default ClientesPage;
